#!/usr/bin/env python3
"""
Monte Carlo discrete-event simulator for the Monaco Smart Barber dynamic queue.

Calibrated from the live `visits` table (60d sample, n=4999):
  service time  mean=35.1 min  sd=13.6 min  p10/p50/p90 = 19.6/33.5/51.4
  -> lognormal(mu, sig) with CV = 13.6/35.1 = 0.3875
     sig^2 = ln(1+CV^2) = 0.13995 ; sig = 0.3741
     mu    = ln(35.1) - sig^2/2 = 3.4882   (=> median e^mu = 32.7, matches p50)
Volume: ~34.6 entries/branch/day (max 83). Branches run 1..6 barbers in prod;
the brief asks to also stress 7..10.

Policies modeled (faithful to the audited code/RPCs):

  A  CURRENT  : dynamic client is BOUND at check-in by compute_fair_barber
                (argmin load-count, then attending, lastCompleted, dailyCount).
                Binding is STICKY-while-present (mig 133): an idle barber can
                only steal a dynamic if its bound barber is NOT present
                (clocked-out / on break / shift-end). A merely-busy bound barber
                keeps it frozen. NO push-on-complete: the freed barber serves
                only after a manual-tap latency. -> faithful to prod today.

  B  CURRENT* : same arrival binding + sticky, but push-on-complete & instant
                tap (no manual latency). Isolates the *binding* cost alone.

  C  POOL     : no arrival binding. Specifics wait for their barber; dynamics
                live in ONE shared pool. A freed barber pulls oldest eligible
                (its specific OR pool head) by global FIFO. Push-on-complete.

  D  POOL+WSJF: like C but pool pick = aging-bounded shortest expected job
                (Phase-2 14.3). aging: waited>30 -> top priority.

  E  POOL+FAIR: shared pool, but a freed barber may pull a pool dynamic ONLY
                if he is not already ahead (done <= min_done+1) UNLESS the
                pool head has waited > FAIR_BYPASS (never starve the client).
                Own specifics always servable. Reconciles "equal cuts" with
                "zero dynamic starvation" -> the recommended design.

All policies pay the same physical chair-turnover gap (30-90s) so deltas are
algorithmic, not the human gap. Only A adds the manual-tap latency (that is the
real, intentional cost of "no push-on-complete").
"""

import heapq, json, math, random, statistics, sys
from dataclasses import dataclass, field

# ---- calibration ----------------------------------------------------------
SVC_MU, SVC_SIG = 3.4882, 0.3741
SVC_LO, SVC_HI = 5.0, 180.0
SHIFT_MIN = 600.0                 # 10 h
GAP_LO, GAP_HI = 0.5, 1.5         # chair turnover, minutes (30-90 s)
ATTN_A_MEAN = 1.5                 # policy A manual-notice-and-tap latency (min)
FAIR_BYPASS = 12.0                # policy E: a pool client waited this long -> anyone serves it

def svc_time(rng):
    x = math.exp(rng.gauss(SVC_MU, SVC_SIG))
    return min(SVC_HI, max(SVC_LO, x))

def gap(rng):
    return rng.uniform(GAP_LO, GAP_HI)

# ---- entities -------------------------------------------------------------
@dataclass
class Client:
    cid: int
    arrival: float
    dynamic: bool
    pref_barber: int           # specific target; for dynamic = bound barber (A/B) or -1 (C/D)
    exp_svc: float             # expected service (for WSJF / fair predictions)
    start: float = -1.0
    finish: float = -1.0
    served_by: int = -1

@dataclass
class Barber:
    bid: int
    busy_until: float = -1.0   # >now => serving
    gap_until: float = -1.0    # >now => physically turning over (occupied, not idle)
    done: int = 0
    busy_min: float = 0.0
    cur: int = -1              # client id in service

    def state(self, t):
        if self.busy_until > t:  return 'BUSY'
        if self.gap_until  > t:  return 'GAP'
        return 'IDLE'

# ---- one shift ------------------------------------------------------------
def simulate(policy, n_barbers, rho, p_dyn, skew, seed):
    rng = random.Random(seed)
    lam = rho * n_barbers / math.exp(SVC_MU + SVC_SIG**2/2)   # arrivals/min

    barbers = [Barber(i) for i in range(n_barbers)]
    clients = {}

    # specific-barber popularity
    if skew == 'zipf':
        w = [1.0/((i+1)**1.1) for i in range(n_barbers)]
    else:
        w = [1.0]*n_barbers
    sw = sum(w); w = [x/sw for x in w]
    cum = []
    acc = 0.0
    for x in w:
        acc += x; cum.append(acc)
    def pick_specific():
        r = rng.random()
        for i, c in enumerate(cum):
            if r <= c: return i
        return n_barbers-1

    # event heap: (time, seq, kind, payload)
    seq = 0
    pq = []
    def push(t, kind, payload):
        nonlocal seq
        heapq.heappush(pq, (t, seq, kind, payload)); seq += 1

    # generate arrivals
    t = 0.0
    cid = 0
    while True:
        t += rng.expovariate(lam)
        if t >= SHIFT_MIN: break
        dyn = rng.random() < p_dyn
        spec = -1 if dyn else pick_specific()
        push(t, 'ARR', cid)
        clients[cid] = Client(cid, t, dyn, spec, svc_time(rng))  # exp_svc = realized (proxy)
        cid += 1

    waiting = []   # client ids, kept in arrival order (priority_order == arrival)
    # invariant integrators
    last_t = 0.0
    inv_dyn_starv = 0.0     # minutes: >=1 idle barber AND >=1 dynamic waiting
    idle_work_min = 0.0     # minutes: >=1 idle barber AND >=1 *feasible* client waiting
    barber_idle_min = 0.0   # total barber-minutes idle (any)

    def present(_bid):
        # baseline: every barber present the whole shift (worst case for A,
        # and the dominant real case). This is what freezes A's bindings.
        return True

    def feasible_for(b, c):
        cl = clients[c]
        if not cl.dynamic:
            return cl.pref_barber == b.bid
        if policy in ('C', 'D'):
            return True                       # shared pool
        if policy == 'E':
            if now[0] - cl.arrival > FAIR_BYPASS:
                return True                   # safety valve: never starve
            mn = min(x.done for x in barbers)
            return b.done <= mn + 1           # don't let a barber already ahead vacuum the pool
        # A/B sticky-while-present
        if cl.pref_barber == -1:              # legacy unbound dynamic
            return True
        if cl.pref_barber == b.bid:
            return True
        return not present(cl.pref_barber)    # steal only if bound barber absent

    def bind_on_arrival(c):
        cl = clients[c]
        if not cl.dynamic or policy in ('C', 'D', 'E'):
            return
        # compute_fair_barber: argmin (load, attending, lastCompleted~done, id)
        # load = waiting-assigned + (1 if busy)
        elig = [b for b in barbers]           # all present in baseline
        def load(b):
            wl = sum(1 for x in waiting if clients[x].pref_barber == b.bid)
            return wl + (1 if b.busy_until > now[0] else 0)
        elig.sort(key=lambda b: (load(b),
                                 1 if b.busy_until > now[0] else 0,
                                 b.done, b.bid))
        cl.pref_barber = elig[0].bid

    def pick_for(b):
        cand = [c for c in waiting if feasible_for(b, c)]
        if not cand:
            return None
        if policy == 'D' and any(clients[c].dynamic for c in cand):
            nowt = now[0]
            def score(c):
                cl = clients[c]
                waited = nowt - cl.arrival
                aging = 1000 if waited > 30 else (100 if waited > 15 else waited)
                return (aging - cl.exp_svc + (nowt - cl.arrival)/1000.0)
            return max(cand, key=score)
        return min(cand, key=lambda c: clients[c].arrival)   # global FIFO

    now = [0.0]
    def integrate(to_t):
        nonlocal last_t, inv_dyn_starv, idle_work_min, barber_idle_min
        dt = to_t - last_t
        if dt <= 0:
            last_t = to_t; return
        idle = [b for b in barbers if b.state(last_t) == 'IDLE']
        n_idle = len(idle)
        barber_idle_min += n_idle * dt
        if n_idle > 0 and waiting:
            if any(clients[c].dynamic for c in waiting):
                inv_dyn_starv += dt
            if any(any(feasible_for(b, c) for c in waiting) for b in idle):
                idle_work_min += dt
        last_t = to_t

    def try_start(b, schedule):
        """schedule: extra latency before the chosen client actually starts."""
        c = pick_for(b)
        if c is None:
            return
        waiting.remove(c)
        cl = clients[c]
        st = now[0] + schedule
        cl.start = st
        cl.served_by = b.bid
        b.cur = c
        b.busy_until = st + cl.exp_svc
        b.gap_until = st            # the 'schedule' window: barber committed/turning
        push(b.busy_until, 'FIN', (b.bid, c))

    # main loop
    while pq:
        et, _, kind, pl = heapq.heappop(pq)
        now[0] = et
        integrate(et)

        if kind == 'ARR':
            bind_on_arrival(pl)
            waiting.append(pl)
            # a free barber "notices" a new client
            for b in barbers:
                if b.state(et) == 'IDLE':
                    lat = gap(rng) + (rng.expovariate(1.0/ATTN_A_MEAN) if policy == 'A' else 0.0)
                    if pick_for(b) is not None:
                        try_start(b, lat)

        elif kind == 'FIN':
            bid, c = pl
            b = barbers[bid]
            cl = clients[c]
            cl.finish = et
            b.done += 1
            b.busy_min += max(0.0, min(et, SHIFT_MIN) - min(cl.start, SHIFT_MIN))
            b.cur = -1
            # push-on-complete for B/C/D (instant claim after physical gap);
            # A waits for manual tap (gap + attn) and only its feasible set.
            if policy == 'A':
                lat = gap(rng) + rng.expovariate(1.0/ATTN_A_MEAN)
            else:
                lat = gap(rng)
            b.gap_until = et + lat        # occupied during turnover
            push(et + lat, 'CLAIM', bid)

        elif kind == 'CLAIM':
            b = barbers[pl]
            if b.state(et) == 'IDLE':
                try_start(b, 0.0)

    now[0] = SHIFT_MIN
    integrate(SHIFT_MIN)

    served = [c for c in clients.values() if c.start >= 0]
    waits = sorted(c.start - c.arrival for c in served)
    def pct(a, q):
        if not a: return 0.0
        i = min(len(a)-1, int(q*len(a)))
        return a[i]
    counts = [b.done for b in barbers]
    mean_c = statistics.mean(counts) if counts else 0
    cv = (statistics.pstdev(counts)/mean_c) if mean_c else 0.0
    jain = (sum(counts)**2)/(len(counts)*sum(x*x for x in counts)) if sum(x*x for x in counts) else 1.0
    avail = n_barbers*SHIFT_MIN
    util = sum(b.busy_min for b in barbers)/avail if avail else 0.0

    return dict(
        served=len(served), arrived=len(clients),
        unserved=len(clients)-len(served),
        wait_p50=pct(waits,0.50), wait_p95=pct(waits,0.95),
        wait_mean=(statistics.mean(waits) if waits else 0.0),
        util=util,
        cv_counts=cv, jain=jain,
        spread=(max(counts)-min(counts)) if counts else 0,
        inv_dyn_starv_min=inv_dyn_starv,
        idle_work_min=idle_work_min,
        idle_total_min=barber_idle_min,
        inv_violated=1 if inv_dyn_starv > 1.0 else 0,
    )

# ---- Monte Carlo grid -----------------------------------------------------
def main():
    BARBERS = [3, 5, 7, 10]
    RHO     = [0.80, 1.00, 1.15]
    PDYN    = [0.25, 0.50, 0.80]
    SKEW    = ['uniform', 'zipf']
    POLS    = ['A', 'B', 'C', 'D', 'E']
    LBL     = {'A':'A current','B':'B bind*','C':'C pool','D':'D wsjf','E':'E fair-pool'}
    REPS    = 120

    agg = {}
    cells = 0
    for nb in BARBERS:
        for rho in RHO:
            for pd in PDYN:
                for sk in SKEW:
                    cells += 1
                    base = hash((nb, rho, pd, sk)) & 0xffffffff
                    for pol in POLS:
                        acc = {}
                        for r in range(REPS):
                            res = simulate(pol, nb, rho, pd, sk, base*131 + r)
                            for k, v in res.items():
                                acc.setdefault(k, []).append(v)
                        key = (nb, rho, pd, sk, pol)
                        agg[key] = {k: statistics.mean(v) for k, v in acc.items()}
    total_runs = cells*len(POLS)*REPS
    print(f"# scenarios={cells}  policies={len(POLS)}  reps={REPS}  "
          f"simulated_shifts={total_runs}\n")

    def hdr():
        return f"{'barbers':>7} |" + "".join(f" {LBL[p]:>11}" for p in POLS)

    # ---- headline: invariant violation & efficiency by policy x barbers ----
    print("== HARD INVARIANT  'si hay dinámicos, ningún barbero desocupado' ==")
    print("   metric = avg minutes/shift with >=1 idle barber AND >=1 dynamic waiting")
    print(hdr())
    for nb in BARBERS:
        cells_=[]
        for pol in POLS:
            ks=[k for k in agg if k[0]==nb and k[4]==pol]
            cells_.append(f"{statistics.mean(agg[k]['inv_dyn_starv_min'] for k in ks):>11.2f}")
        print(f"{nb:>7} |" + "".join(f" {c}" for c in cells_))

    print("\n   violation RATE  (% of shifts with >1 idle-min while a dynamic waits)")
    print(hdr())
    for nb in BARBERS:
        cells_=[]
        for pol in POLS:
            ks=[k for k in agg if k[0]==nb and k[4]==pol]
            cells_.append(f"{100*statistics.mean(agg[k]['inv_violated'] for k in ks):>10.1f}%")
        print(f"{nb:>7} |" + "".join(f" {c}" for c in cells_))

    # ---- efficiency outcomes ----
    def block(title, field, fmt, scale=1.0):
        print(f"\n== {title} ==")
        print(hdr())
        for nb in BARBERS:
            cells_=[]
            for pol in POLS:
                ks=[k for k in agg if k[0]==nb and k[4]==pol]
                cells_.append(f"{fmt.format(scale*statistics.mean(agg[k][field] for k in ks)):>11}")
            print(f"{nb:>7} |" + "".join(f" {c}" for c in cells_))

    block("Barber utilization (busy / available)", 'util', "{:.1%}")
    block("Cut-count inequality  CV (0=perfectly equal, lower better)",
          'cv_counts', "{:.3f}")
    block("Cut-count spread  max-min cuts between barbers", 'spread', "{:.1f}")
    block("Wait time P50 (min, service start - arrival)", 'wait_p50', "{:.1f}")
    block("Wait time P95 (min)", 'wait_p95', "{:.1f}")
    block("Clients served per shift", 'served', "{:.1f}")
    block("Jain fairness index of cut-counts (1.0 = perfectly equal)", 'jain', "{:.4f}")

    # ---- worst cells for current policy A vs recommended E ----
    print("\n== Worst A cells by dynamic-starvation  (A current  ->  E fair-pool) ==")
    worst = sorted((v['inv_dyn_starv_min'], k) for k,v in agg.items() if k[4]=='A')
    for val,k in worst[-10:][::-1]:
        nb,rho,pd,sk,_=k
        e=agg[(nb,rho,pd,sk,'E')]
        print(f"  b={nb:>2} rho={rho} pdyn={pd} skew={sk:7} | "
              f"A starv={val:6.1f}m wP50={agg[k]['wait_p50']:5.1f} cv={agg[k]['cv_counts']:.3f}"
              f"  ->  E starv={e['inv_dyn_starv_min']:4.2f}m wP50={e['wait_p50']:5.1f} cv={e['cv_counts']:.3f}")

    with open('/Users/ignaciobaldovino/MSB_FULL/MonacoSmartBarber/docs/sim/results.json','w') as f:
        json.dump({"|".join(map(str,k)): v for k,v in agg.items()}, f, indent=1)
    print("\n[written] docs/sim/results.json")

if __name__ == '__main__':
    main()
