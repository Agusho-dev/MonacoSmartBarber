'use client'

import { useState, useTransition } from 'react'
import {
  Copy, Eye, EyeOff, Wifi, WifiOff, ExternalLink, Instagram, Facebook, Bot, ScrollText,
} from 'lucide-react'
import { ModelPicker } from '../shared/model-picker'
import { AiLogsPanel } from './ai-logs-panel'
import { TagsSection } from './tags-section'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { toast } from 'sonner'
import { saveOrgWhatsAppConfig } from '@/lib/actions/whatsapp-meta'
import { saveOrgInstagramConfig } from '@/lib/actions/instagram-meta'
import { saveOrgAiConfig } from '@/lib/actions/ai-config'
import { WhatsAppIcon } from '../shared/icons'
import { TAG_COLORS } from '../shared/helpers'
import { useMensajeria } from '../shared/mensajeria-context'

type SettingsTab = 'whatsapp' | 'instagram' | 'facebook' | 'ai' | 'logs' | 'tags'

export function SettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const {
    waConfig, setWaConfig, igConfig, setIgConfig,
    aiConfig, setAiConfig,
    tags, handleCreateTag, handleDeleteTag, handleUpdateTag,
    isConfigured, isInstagramConfigured,
    creatingTag,
  } = useMensajeria()

  const [settingsTab, setSettingsTab] = useState<SettingsTab>('whatsapp')

  // WA config
  const [configForm, setConfigForm] = useState({
    whatsapp_access_token: waConfig?.whatsapp_access_token ?? '',
    whatsapp_phone_id: waConfig?.whatsapp_phone_id ?? '',
    whatsapp_business_id: waConfig?.whatsapp_business_id ?? '',
    app_secret: waConfig?.app_secret ?? '',
  })
  const [showToken, setShowToken] = useState(false)
  const [savingConfig, startSavingConfig] = useTransition()

  // IG config
  const [igConfigForm, setIgConfigForm] = useState({
    instagram_page_id: igConfig?.instagram_page_id ?? '',
    instagram_page_access_token: igConfig?.instagram_page_access_token ?? '',
    instagram_account_id: igConfig?.instagram_account_id ?? '',
    app_secret: igConfig?.app_secret ?? '',
  })
  const [showIgToken, setShowIgToken] = useState(false)
  const [savingIgConfig, startSavingIgConfig] = useTransition()

  // AI config
  const [aiConfigForm, setAiConfigForm] = useState({
    openai_api_key: aiConfig?.openai_api_key ?? '',
    anthropic_api_key: aiConfig?.anthropic_api_key ?? '',
    openrouter_api_key: aiConfig?.openrouter_api_key ?? '',
    default_model: aiConfig?.default_model ?? 'gpt-4o-mini',
    default_system_prompt: aiConfig?.default_system_prompt ?? '',
    default_temperature: aiConfig?.default_temperature ?? 0.7,
    default_max_tokens: aiConfig?.default_max_tokens ?? 500,
  })
  const [showOpenAiKey, setShowOpenAiKey] = useState(false)
  const [showAnthropicKey, setShowAnthropicKey] = useState(false)
  const [showOpenRouterKey, setShowOpenRouterKey] = useState(false)
  const [savingAiConfig, startSavingAiConfig] = useTransition()

  // Tags
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0])

  const handleSaveConfig = () => {
    if (!configForm.whatsapp_access_token || !configForm.whatsapp_phone_id || !configForm.whatsapp_business_id) {
      toast.error('Completá los tres campos'); return
    }
    startSavingConfig(async () => {
      const result = await saveOrgWhatsAppConfig(configForm as any)
      if (result.error) { toast.error(result.error) }
      else {
        toast.success('Configuración guardada — el canal WhatsApp fue creado automáticamente')
        if (result.data) setWaConfig(result.data as any)
      }
    })
  }

  const handleSaveIgConfig = () => {
    if (!igConfigForm.instagram_page_id || !igConfigForm.instagram_page_access_token) {
      toast.error('Completá el Page ID y el Access Token'); return
    }
    startSavingIgConfig(async () => {
      const result = await saveOrgInstagramConfig(igConfigForm as any)
      if (result.error) { toast.error(result.error) }
      else {
        toast.success('Instagram conectado — el canal fue creado automáticamente')
        if (result.data) setIgConfig(result.data as any)
      }
    })
  }

  const handleSaveAiConfig = () => {
    if (!aiConfigForm.openai_api_key && !aiConfigForm.anthropic_api_key && !aiConfigForm.openrouter_api_key) {
      toast.error('Configurá al menos una API key (OpenAI o Anthropic)'); return
    }
    startSavingAiConfig(async () => {
      const result = await saveOrgAiConfig(aiConfigForm)
      if (result.error) { toast.error(result.error) }
      else {
        toast.success('Configuración de IA guardada')
        if (result.data) setAiConfig(result.data)
      }
    })
  }

  const isAiConfigured = !!(aiConfig?.openai_api_key || aiConfig?.anthropic_api_key || aiConfig?.openrouter_api_key)

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copiado`))
  }

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/whatsapp` : '/api/webhooks/whatsapp'
  const webhookUrlInstagram = typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/instagram` : '/api/webhooks/instagram'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md flex flex-col p-0">
        <div className="px-6 py-4 border-b border shrink-0">
          <p className="font-semibold text-foreground mb-3">Configuración</p>
          <div className="grid grid-cols-6 gap-1 bg-card p-1 rounded-lg">
            {(['whatsapp', 'instagram', 'facebook', 'ai', 'logs', 'tags'] as SettingsTab[]).map(tab => (
              <button key={tab} onClick={() => setSettingsTab(tab)}
                className={`flex flex-col items-center justify-center gap-0.5 py-1.5 px-1 rounded-md text-[10px] font-medium transition-colors ${settingsTab === tab ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {tab === 'whatsapp' && <WhatsAppIcon className="size-3.5 text-green-400" />}
                {tab === 'instagram' && <Instagram className="size-3.5 text-pink-400" />}
                {tab === 'facebook' && <Facebook className="size-3.5 text-blue-400" />}
                {tab === 'ai' && <Bot className="size-3.5 text-purple-400" />}
                {tab === 'logs' && <ScrollText className="size-3.5 text-amber-400" />}
                {tab === 'tags' && <span className="text-base leading-none">🏷️</span>}
                <span>{tab === 'whatsapp' ? 'WA' : tab === 'instagram' ? 'IG' : tab === 'facebook' ? 'FB' : tab === 'ai' ? 'IA' : tab === 'logs' ? 'Logs' : 'Tags'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* WhatsApp tab */}
          {settingsTab === 'whatsapp' && (
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${isConfigured ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'}`}>
                  {isConfigured ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
                  {isConfigured ? 'Conectado' : 'Sin configurar'}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="size-5 rounded-full bg-green-500/10 flex items-center justify-center text-green-400 font-bold text-[10px]">1</div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Configurar Webhook en Meta</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed pl-7">
                  En Meta Developer Console → <strong className="text-foreground">WhatsApp → Configuración → Webhook</strong>
                </p>
                <div className="pl-7 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">URL de devolución de llamada</Label>
                    <div className="flex items-center gap-2">
                      <input readOnly className="flex-1 rounded-lg bg-card px-3 py-2 text-xs text-foreground outline-none font-mono truncate" value={webhookUrl} />
                      <button className="shrink-0 p-2 rounded-lg bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" onClick={() => copyToClipboard(webhookUrl, 'URL')}>
                        <Copy className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">Token de verificación</Label>
                    {waConfig?.verify_token ? (
                      <div className="flex items-center gap-2">
                        <input readOnly className="flex-1 rounded-lg bg-card px-3 py-2 text-xs text-foreground outline-none font-mono truncate" value={waConfig.verify_token} />
                        <button className="shrink-0 p-2 rounded-lg bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" onClick={() => copyToClipboard(waConfig.verify_token, 'Token')}>
                          <Copy className="size-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-card px-3 py-2.5 text-xs text-muted-foreground italic">
                        Se genera al guardar las credenciales →
                      </div>
                    )}
                  </div>
                  <div className="rounded-lg bg-muted border border p-3 flex items-start gap-2.5">
                    <span className="text-green-400 text-[10px] font-mono shrink-0 mt-0.5">●</span>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Evento a suscribir:</p>
                      <code className="text-xs text-green-400 font-mono">messages</code>
                    </div>
                  </div>
                </div>
              </div>

              <Separator className="bg-white/5" />

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="size-5 rounded-full bg-green-500/10 flex items-center justify-center text-green-400 font-bold text-[10px]">2</div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Credenciales Meta API</h3>
                </div>
                <div className="pl-7 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">Access Token</Label>
                    <div className="relative">
                      <input type={showToken ? 'text' : 'password'}
                        className="w-full rounded-lg bg-card px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-green-500/40"
                        placeholder="EAA..." value={configForm.whatsapp_access_token ?? ''}
                        onChange={(e) => setConfigForm(prev => ({ ...prev, whatsapp_access_token: e.target.value }))} />
                      <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowToken(v => !v)}>
                        {showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">Phone Number ID</Label>
                    <input type="text" className="w-full rounded-lg bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-green-500/40"
                      placeholder="1068552459672379" value={configForm.whatsapp_phone_id ?? ''}
                      onChange={(e) => setConfigForm(prev => ({ ...prev, whatsapp_phone_id: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">WhatsApp Business Account ID</Label>
                    <input type="text" className="w-full rounded-lg bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-green-500/40"
                      placeholder="868078746261917" value={configForm.whatsapp_business_id ?? ''}
                      onChange={(e) => setConfigForm(prev => ({ ...prev, whatsapp_business_id: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">App Secret <span className="text-muted-foreground font-normal">(para verificación HMAC)</span></Label>
                    <input type="password" className="w-full rounded-lg bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-green-500/40"
                      placeholder="abc123..." value={configForm.app_secret ?? ''}
                      onChange={(e) => setConfigForm(prev => ({ ...prev, app_secret: e.target.value }))} />
                    <p className="text-[10px] text-muted-foreground">Meta App → Configuración → Básica → Clave secreta de la app</p>
                  </div>
                  <Button className="w-full bg-green-600 hover:bg-green-500 text-white" onClick={handleSaveConfig} disabled={savingConfig}>
                    {savingConfig ? 'Guardando...' : 'Guardar credenciales'}
                  </Button>
                </div>
              </div>

              <Separator className="bg-white/5" />
              <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-green-400 hover:text-green-300">
                <ExternalLink className="size-3" /> Guía Meta Cloud API
              </a>
            </div>
          )}

          {/* Instagram tab */}
          {settingsTab === 'instagram' && (
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${isInstagramConfigured ? 'bg-pink-500/10 text-pink-400 border border-pink-500/20' : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'}`}>
                  {isInstagramConfigured ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
                  {isInstagramConfigured ? 'Conectado' : 'Sin configurar'}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="size-5 rounded-full bg-pink-500/10 flex items-center justify-center text-pink-400 font-bold text-[10px]">1</div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Configurar Webhook en Meta</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed pl-7">
                  En Meta Developer Console → <strong className="text-foreground">Instagram → Webhooks</strong>, suscribite al campo <code className="text-pink-400">messages</code>.
                </p>
                <div className="pl-7 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">URL de devolución de llamada</Label>
                    <div className="flex items-center gap-2">
                      <input readOnly className="flex-1 rounded-lg bg-card px-3 py-2 text-xs text-foreground outline-none font-mono truncate" value={webhookUrlInstagram} />
                      <button className="shrink-0 p-2 rounded-lg bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" onClick={() => copyToClipboard(webhookUrlInstagram, 'URL')}>
                        <Copy className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">Token de verificación</Label>
                    {igConfig?.verify_token ? (
                      <div className="flex items-center gap-2">
                        <input readOnly className="flex-1 rounded-lg bg-card px-3 py-2 text-xs text-foreground outline-none font-mono truncate" value={igConfig.verify_token} />
                        <button className="shrink-0 p-2 rounded-lg bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" onClick={() => copyToClipboard(igConfig.verify_token, 'Token')}>
                          <Copy className="size-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-card px-3 py-2.5 text-xs text-muted-foreground italic">
                        Se genera al guardar las credenciales →
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <Separator className="bg-white/5" />

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="size-5 rounded-full bg-pink-500/10 flex items-center justify-center text-pink-400 font-bold text-[10px]">2</div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Credenciales Instagram API</h3>
                </div>
                <div className="pl-7 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">Facebook Page ID <span className="text-pink-400">*</span></Label>
                    <input type="text" className="w-full rounded-lg bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-pink-500/40"
                      placeholder="123456789012345" value={igConfigForm.instagram_page_id}
                      onChange={(e) => setIgConfigForm(prev => ({ ...prev, instagram_page_id: e.target.value }))} />
                    <p className="text-[10px] text-muted-foreground">El ID de la Página de Facebook conectada a tu Instagram Business</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">Page Access Token <span className="text-pink-400">*</span></Label>
                    <div className="relative">
                      <input type={showIgToken ? 'text' : 'password'}
                        className="w-full rounded-lg bg-card px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-pink-500/40"
                        placeholder="EAA..." value={igConfigForm.instagram_page_access_token}
                        onChange={(e) => setIgConfigForm(prev => ({ ...prev, instagram_page_access_token: e.target.value }))} />
                      <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowIgToken(v => !v)}>
                        {showIgToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">Instagram Account ID <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                    <input type="text" className="w-full rounded-lg bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-pink-500/40"
                      placeholder="17841400000000000" value={igConfigForm.instagram_account_id}
                      onChange={(e) => setIgConfigForm(prev => ({ ...prev, instagram_account_id: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">App Secret <span className="text-muted-foreground font-normal">(para verificación HMAC)</span></Label>
                    <input type="password" className="w-full rounded-lg bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-pink-500/40"
                      placeholder="abc123..." value={igConfigForm.app_secret ?? ''}
                      onChange={(e) => setIgConfigForm(prev => ({ ...prev, app_secret: e.target.value }))} />
                  </div>
                  <Button className="w-full bg-pink-600 hover:bg-pink-500 text-white" onClick={handleSaveIgConfig} disabled={savingIgConfig}>
                    {savingIgConfig ? 'Guardando...' : 'Guardar credenciales'}
                  </Button>
                </div>
              </div>

              <Separator className="bg-white/5" />
              <div className="rounded-lg bg-muted border border p-3 space-y-1.5">
                <p className="text-[11px] font-medium text-foreground">Requisitos previos</p>
                {[
                  'Cuenta de Instagram Business o Creator',
                  'Página de Facebook conectada a la cuenta IG',
                  'App de Meta con instagram_manage_messages',
                  'Suscripción al webhook del producto Instagram',
                ].map(r => (
                  <div key={r} className="flex items-start gap-2">
                    <div className="size-1.5 rounded-full bg-pink-400 mt-1.5 shrink-0" />
                    <span className="text-[11px] text-muted-foreground">{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Facebook tab */}
          {settingsTab === 'facebook' && (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
              <div className="size-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <Facebook className="size-8 text-blue-400" />
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Facebook Messenger</p>
                <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                  Próximamente podrás conectar tu página de Facebook y atender todos los mensajes de Messenger desde el dashboard.
                </p>
              </div>
              <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/5">Próximamente</Badge>
            </div>
          )}

          {/* AI tab */}
          {settingsTab === 'ai' && (
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${isAiConfigured ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'}`}>
                  {isAiConfigured ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
                  {isAiConfigured ? 'Configurado' : 'Sin configurar'}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-foreground mb-1">Proveedores de IA</p>
                <p className="text-[11px] text-muted-foreground">
                  Configurá las API keys para usar nodos de IA en los workflows. Podés usar OpenAI, Anthropic, OpenRouter, o combinarlos.
                </p>
              </div>

              <Separator />

              {/* OpenAI */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="size-5 rounded-full bg-green-500/10 flex items-center justify-center text-green-400 font-bold text-[10px]">1</div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">OpenAI</h3>
                </div>
                <div className="pl-7 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">API Key</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type={showOpenAiKey ? 'text' : 'password'}
                        className="flex-1 rounded-lg bg-card px-3 py-2 text-xs text-foreground outline-none font-mono border"
                        placeholder="sk-..."
                        value={aiConfigForm.openai_api_key}
                        onChange={e => setAiConfigForm(p => ({ ...p, openai_api_key: e.target.value }))}
                      />
                      <button className="shrink-0 p-2 rounded-lg bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setShowOpenAiKey(!showOpenAiKey)}>
                        {showOpenAiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Modelos disponibles: GPT-4o Mini, GPT-4o, GPT-4.1 Mini, GPT-4.1
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Anthropic */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="size-5 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400 font-bold text-[10px]">2</div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Anthropic</h3>
                </div>
                <div className="pl-7 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">API Key</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type={showAnthropicKey ? 'text' : 'password'}
                        className="flex-1 rounded-lg bg-card px-3 py-2 text-xs text-foreground outline-none font-mono border"
                        placeholder="sk-ant-..."
                        value={aiConfigForm.anthropic_api_key}
                        onChange={e => setAiConfigForm(p => ({ ...p, anthropic_api_key: e.target.value }))}
                      />
                      <button className="shrink-0 p-2 rounded-lg bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setShowAnthropicKey(!showAnthropicKey)}>
                        {showAnthropicKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Modelos disponibles: Claude Haiku 4.5, Claude Sonnet 4.6
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              {/* OpenRouter */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="size-5 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-400 font-bold text-[10px]">3</div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">OpenRouter</h3>
                </div>
                <div className="pl-7 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">API Key</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type={showOpenRouterKey ? 'text' : 'password'}
                        className="flex-1 rounded-lg bg-card px-3 py-2 text-xs text-foreground outline-none font-mono border"
                        placeholder="sk-or-..."
                        value={aiConfigForm.openrouter_api_key}
                        onChange={e => setAiConfigForm(p => ({ ...p, openrouter_api_key: e.target.value }))}
                      />
                      <button className="shrink-0 p-2 rounded-lg bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setShowOpenRouterKey(!showOpenRouterKey)}>
                        {showOpenRouterKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Acceso a cientos de modelos (Llama, Mistral, Gemini, etc.) a través de openrouter.ai. Incluye modelos gratuitos.
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Defaults */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="size-5 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400 font-bold text-[10px]">4</div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Valores por defecto</h3>
                </div>
                <div className="pl-7 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">Modelo por defecto</Label>
                    <ModelPicker
                      value={aiConfigForm.default_model}
                      onChange={id => setAiConfigForm(p => ({ ...p, default_model: id }))}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Buscá por nombre o pegá un model ID de OpenRouter (ej: <code className="text-cyan-400">google/gemma-2-9b-it:free</code>).
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">System prompt por defecto</Label>
                    <textarea
                      className="w-full rounded-lg bg-card px-3 py-2 text-xs text-foreground outline-none border resize-none"
                      rows={4}
                      placeholder="Sos un asistente de la barbería. Respondé consultas sobre horarios, servicios y precios..."
                      value={aiConfigForm.default_system_prompt}
                      onChange={e => setAiConfigForm(p => ({ ...p, default_system_prompt: e.target.value }))}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Este prompt se usará como base cuando un nodo de IA no tenga prompt propio configurado.
                    </p>
                  </div>
                </div>
              </div>

              <Button onClick={handleSaveAiConfig} disabled={savingAiConfig} className="w-full bg-purple-600 hover:bg-purple-500 text-white">
                {savingAiConfig ? 'Guardando...' : 'Guardar configuración de IA'}
              </Button>
            </div>
          )}

          {/* Logs tab */}
          {settingsTab === 'logs' && <AiLogsPanel />}

          {/* Tags tab */}
          {settingsTab === 'tags' && (
            <TagsSection
              tags={tags}
              newTagName={newTagName}
              setNewTagName={setNewTagName}
              newTagColor={newTagColor}
              setNewTagColor={setNewTagColor}
              handleCreateTag={handleCreateTag}
              handleDeleteTag={handleDeleteTag}
              handleUpdateTag={handleUpdateTag}
              creatingTag={creatingTag}
              aiConfig={aiConfig}
              setAiConfig={setAiConfig}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
