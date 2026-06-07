'use client'

import { Trophy } from 'lucide-react'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ProdePageData } from './_lib/types'
import { ProdeHero } from './_components/prode-hero'
import { ResultadosTab } from './_components/resultados/resultados-tab'
import { QuinielaTab } from './_components/quiniela/quiniela-tab'
import { ParticipantesTab } from './_components/participantes/participantes-tab'
import { PremiosTab } from './_components/premios/premios-tab'
import { ConfigTab } from './_components/config/config-tab'
import { CanjearTab } from './_components/canjear/canjear-tab'
import { CanjesTab } from './_components/canjes/canjes-tab'

export function ProdeClient({ data }: { data: ProdePageData | null }) {
  if (!data) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="size-5 text-amber-500" /> Prode Mundial
            </CardTitle>
            <CardDescription>
              Todavía no hay ningún torneo configurado para esta organización.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <ProdeHero tournament={data.tournament} stats={data.stats} />

      <Tabs defaultValue="resultados" className="w-full">
        <TabsList className="flex w-full max-w-full justify-start gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="resultados" className="shrink-0">Resultados</TabsTrigger>
          <TabsTrigger value="quiniela" className="shrink-0">Quiniela</TabsTrigger>
          <TabsTrigger value="participantes" className="shrink-0">Participantes</TabsTrigger>
          <TabsTrigger value="premios" className="shrink-0">Premios</TabsTrigger>
          <TabsTrigger value="config" className="shrink-0">Configuración</TabsTrigger>
          <TabsTrigger value="canjear" className="shrink-0">Canjear premio</TabsTrigger>
          <TabsTrigger value="canjes" className="shrink-0">Canjes</TabsTrigger>
        </TabsList>

        <TabsContent value="resultados" className="mt-4">
          <ResultadosTab matches={data.matches} teams={data.teams} lastSyncAt={data.lastSyncAt} />
        </TabsContent>
        <TabsContent value="quiniela" className="mt-4">
          <QuinielaTab questions={data.questions} teams={data.teams} distribution={data.distribution} />
        </TabsContent>
        <TabsContent value="participantes" className="mt-4">
          <ParticipantesTab participants={data.participants} leagues={data.leagues} />
        </TabsContent>
        <TabsContent value="premios" className="mt-4">
          <PremiosTab
            tournament={data.tournament}
            weeklyPrizes={data.weeklyPrizes}
            challengePrizes={data.challengePrizes}
            rewards={data.rewards}
          />
        </TabsContent>
        <TabsContent value="config" className="mt-4">
          <ConfigTab
            tournament={data.tournament}
            whatsappActive={data.whatsappActive}
            reminderTemplateStatus={data.reminderTemplateStatus}
          />
        </TabsContent>
        <TabsContent value="canjear" className="mt-4">
          <CanjearTab />
        </TabsContent>
        <TabsContent value="canjes" className="mt-4">
          <CanjesTab redemptions={data.redemptions} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
