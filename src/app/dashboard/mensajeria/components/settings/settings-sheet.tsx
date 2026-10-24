'use client'

// La configuración de Mensajería, como la de WhatsApp para iOS (23/oct/2026,
// tercera ronda): una lista de celdas con su ícono de color (WhatsApp,
// Instagram, Facebook, IA, el registro de la IA y las etiquetas) y cada una
// abre su pantalla, con «‹ Configuración» para volver. Adentro, listas
// agrupadas: los campos con su nombre arriba, los secretos con el ojo, los
// datos para copiar con su botón y las acciones en verde. Antes era una tira de
// seis pestañas de 10 px («WA», «IG», «FB»…) y formularios del dashboard.
// - Celular: la hoja ocupa la pantalla entera, con la barra de iOS («Listo»).
// - Compu: el panel de la derecha, con la piel de WhatsApp para Mac.
// Es la Sheet de @/components/ui (z-50): tapa la barra de vidrio y las capas.
// Lleva .wa-scope porque el portal sale de la de Mensajería.

import { useState, useTransition, type ReactNode } from 'react'
import {
  Bot, Check, ChevronLeft, Copy, ExternalLink, Facebook, Instagram, ScrollText, Tag, Wifi, WifiOff, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { saveOrgWhatsAppConfig } from '@/lib/actions/whatsapp-meta'
import { saveOrgInstagramConfig } from '@/lib/actions/instagram-meta'
import { saveOrgAiConfig } from '@/lib/actions/ai-config'
import type { OrgWhatsAppConfig, OrgInstagramConfig } from '@/lib/types/database'
import { cn } from '@/lib/utils'
import { AiLogsPanel } from './ai-logs-panel'
import { CeldaModeloIos } from './celda-modelo'
import { TagsSection } from './tags-section'
import { WhatsAppIcon } from '../shared/icons'
import { MODEL_GROUPS } from '../shared/model-picker'
import { TAG_COLORS } from '../shared/helpers'
import { useMensajeria } from '../shared/mensajeria-context'
import { useEntradaDeHoja } from '../inbox/entrada-de-hoja'
import {
  BotonIconoIos, CeldaAccionIos, CeldaCampoIos, CeldaIos, CeldaNavegacionIos, CLASE_CELDA, CLASE_CUERPO, GrupoIos,
  IconoCeldaIos, TEXTO_PRINCIPAL, TEXTO_SECUNDARIO, VacioIos, avisarFalla,
} from '../navegacion/lista-ios'

type Pantalla = 'whatsapp' | 'instagram' | 'facebook' | 'ai' | 'logs' | 'tags'

const TITULOS: Record<Pantalla, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  ai: 'IA',
  logs: 'Registro',
  tags: 'Etiquetas',
}

/** «GPT-5.2, GPT-5.1 y GPT-5 Mini»: los modelos de un proveedor, para la aclaración de su clave. */
function modelosDe(proveedor: (typeof MODEL_GROUPS)[number]['provider']): string {
  const nombres = MODEL_GROUPS.find((g) => g.provider === proveedor)?.models.map((m) => m.label) ?? []
  return nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}` : nombres.join('')
}

export function SettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const {
    waConfig, setWaConfig, igConfig, setIgConfig,
    aiConfig, setAiConfig,
    tags, handleCreateTag, handleDeleteTag, handleUpdateTag,
    isConfigured, isInstagramConfigured,
    creatingTag,
  } = useMensajeria()

  // null: la lista de arriba. Al cerrar la hoja vuelve a la lista.
  const [pantalla, setPantalla] = useState<Pantalla | null>(null)
  // Cuando la trae el «atrás» del sistema del iPhone, la lista vuelve sin
  // entrar animada: el sistema ya mostró su foto mientras se deslizaba.
  const [listaQuieta, setListaQuieta] = useState(false)
  const irA = (p: Pantalla | null) => {
    setListaQuieta(false)
    setPantalla(p)
  }

  // En el celular, la hoja y cada una de sus pantallas son entradas del
  // historial (#/configuracion, #/configuracion/whatsapp): el «atrás» del
  // sistema vuelve de una pantalla a la lista y de la lista cierra la hoja,
  // como en la Configuración de iOS (entrada-de-hoja.ts).
  useEntradaDeHoja(open, () => onOpenChange(false), 'configuracion')
  useEntradaDeHoja(
    open && pantalla !== null,
    (deUna) => {
      setListaQuieta(deUna)
      setPantalla(null)
    },
    pantalla ?? 'pantalla',
  )

  // WA config
  const [configForm, setConfigForm] = useState({
    whatsapp_access_token: waConfig?.whatsapp_access_token ?? '',
    whatsapp_phone_id: waConfig?.whatsapp_phone_id ?? '',
    whatsapp_business_id: waConfig?.whatsapp_business_id ?? '',
    app_secret: waConfig?.app_secret ?? '',
  })
  const [savingConfig, startSavingConfig] = useTransition()

  // IG config
  const [igConfigForm, setIgConfigForm] = useState({
    instagram_page_id: igConfig?.instagram_page_id ?? '',
    instagram_page_access_token: igConfig?.instagram_page_access_token ?? '',
    instagram_account_id: igConfig?.instagram_account_id ?? '',
    app_secret: igConfig?.app_secret ?? '',
  })
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
  const [savingAiConfig, startSavingAiConfig] = useTransition()

  // Tags
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0])

  const handleSaveConfig = () => {
    if (!configForm.whatsapp_access_token || !configForm.whatsapp_phone_id || !configForm.whatsapp_business_id) {
      toast.error('Completá el token, el Phone Number ID y el Business Account ID'); return
    }
    startSavingConfig(async () => {
      try {
        const result = await saveOrgWhatsAppConfig(configForm)
        if (result.error) { toast.error(result.error) }
        else {
          toast.success('Configuración guardada: el canal de WhatsApp quedó creado')
          if (result.data) setWaConfig(result.data as OrgWhatsAppConfig)
        }
      } catch (e) {
        avisarFalla(e, 'No se pudo guardar. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  const handleSaveIgConfig = () => {
    if (!igConfigForm.instagram_page_id || !igConfigForm.instagram_page_access_token) {
      toast.error('Completá el Page ID y el Access Token'); return
    }
    startSavingIgConfig(async () => {
      try {
        const result = await saveOrgInstagramConfig(igConfigForm)
        if (result.error) { toast.error(result.error) }
        else {
          toast.success('Instagram conectado: el canal quedó creado')
          if (result.data) setIgConfig(result.data as OrgInstagramConfig)
        }
      } catch (e) {
        avisarFalla(e, 'No se pudo guardar. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  const handleSaveAiConfig = () => {
    if (!aiConfigForm.openai_api_key && !aiConfigForm.anthropic_api_key && !aiConfigForm.openrouter_api_key) {
      toast.error('Cargá al menos una clave (OpenAI, Anthropic u OpenRouter)'); return
    }
    startSavingAiConfig(async () => {
      try {
        const result = await saveOrgAiConfig(aiConfigForm)
        if (result.error) { toast.error(result.error) }
        else {
          toast.success('Configuración de IA guardada')
          if (result.data) setAiConfig(result.data)
        }
      } catch (e) {
        avisarFalla(e, 'No se pudo guardar. Revisá la conexión y probá de nuevo.')
      }
    })
  }

  const isAiConfigured = !!(aiConfig?.openai_api_key || aiConfig?.anthropic_api_key || aiConfig?.openrouter_api_key)

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copiado`),
      () => toast.error('No se pudo copiar: mantené apretado el texto para copiarlo.'),
    )
  }

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/whatsapp` : '/api/webhooks/whatsapp'
  const webhookUrlInstagram = typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/instagram` : '/api/webhooks/instagram'

  const titulo = pantalla ? TITULOS[pantalla] : 'Configuración'
  const volver = pantalla ? () => irA(null) : undefined

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* aria-describedby={undefined}: la hoja no tiene descripción (Radix avisa si no se dice). */}
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-describedby={undefined}
        // Al terminar de cerrarse, la próxima vez abre en la lista.
        onCloseAutoFocus={() => irA(null)}
        className={cn(
          'wa-scope gap-0 overflow-hidden p-0 text-[var(--wa-text)] outline-none',
          // En el celular ocupa la pantalla: sin el borde de la izquierda (quedaba una raya en el canto).
          'w-full max-w-none border-[var(--wa-divider)] bg-[var(--wa-bg)] max-lg:border-l-0 sm:max-w-none lg:w-[440px]',
          'data-[state=open]:duration-300 data-[state=open]:ease-out',
        )}
      >
        {/* Celular: la barra de iOS. */}
        <div className="relative flex h-11 shrink-0 items-center justify-between border-b-[0.5px] border-[var(--wa-divider)] pl-1 pr-2 lg:hidden">
          {volver ? (
            <button
              type="button"
              onClick={volver}
              className="relative z-10 flex h-11 items-center gap-0.5 rounded-lg pr-2 text-[17px] text-[var(--wa-accent)] outline-none transition-opacity duration-150 [-webkit-tap-highlight-color:transparent] active:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
            >
              <ChevronLeft aria-hidden className="size-7" strokeWidth={2.2} />
              Configuración
            </button>
          ) : (
            <span />
          )}
          {/* El título de Radix (siempre en el DOM): el de la compu es para la vista. */}
          <SheetTitle
            className={cn(
              'pointer-events-none absolute truncate text-center text-[17px] font-semibold leading-[22px] text-[var(--wa-text)]',
              volver ? 'inset-x-36' : 'inset-x-24',
            )}
          >
            {titulo}
          </SheetTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="relative z-10 flex h-11 min-w-11 items-center justify-center rounded-lg px-2 text-[17px] font-semibold text-[var(--wa-accent)] outline-none transition-opacity duration-150 [-webkit-tap-highlight-color:transparent] active:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
          >
            Listo
          </button>
        </div>

        {/* Compu: el encabezado del panel, con la flecha para volver a la lista y la X. */}
        <div className="hidden h-14 shrink-0 items-center gap-1 border-b border-[var(--wa-divider)] pl-3 pr-3 lg:flex">
          {volver && (
            <button
              type="button"
              onClick={volver}
              aria-label="Volver a Configuración"
              title="Volver a Configuración"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--wa-text-2)] outline-none transition-colors hover:bg-[var(--wa-hover)] hover:text-[var(--wa-text)] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
            >
              <ChevronLeft aria-hidden className="size-5" />
            </button>
          )}
          <p aria-hidden className={cn('min-w-0 flex-1 truncate text-[16px] font-semibold text-[var(--wa-text)]', !volver && 'pl-2')}>
            {titulo}
          </p>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Cerrar"
            title="Cerrar"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--wa-text-2)] outline-none transition-colors hover:bg-[var(--wa-hover)] hover:text-[var(--wa-text)] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
          >
            <X aria-hidden className="size-[18px]" />
          </button>
        </div>

        {/* Cada pantalla entra desde la derecha (la lista, desde la izquierda), como en iOS. */}
        <div
          key={pantalla ?? 'lista'}
          className={cn(
            'wa-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-[calc(env(safe-area-inset-bottom,0px)_+_2rem)] lg:px-4 lg:pb-8 lg:pt-4',
            !listaQuieta && 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:animation-duration-200',
            pantalla ? 'motion-safe:slide-in-from-right-8' : 'motion-safe:slide-in-from-left-8',
          )}
        >
          {pantalla === null && (
            <>
              <GrupoIos titulo="Canales">
                <CeldaNavegacionIos
                  icono={<IconoCeldaIos glifo={<WhatsAppIcon className="size-[19px] lg:size-4" />} color="verde" />}
                  detalle={isConfigured ? 'Conectado' : 'Sin conectar'}
                  onClick={() => irA('whatsapp')}
                >
                  WhatsApp
                </CeldaNavegacionIos>
                <CeldaNavegacionIos
                  icono={<IconoCeldaIos icono={Instagram} color="rosa" />}
                  detalle={isInstagramConfigured ? 'Conectado' : 'Sin conectar'}
                  onClick={() => irA('instagram')}
                >
                  Instagram
                </CeldaNavegacionIos>
                <CeldaNavegacionIos
                  icono={<IconoCeldaIos icono={Facebook} color="azul" />}
                  detalle="Próximamente"
                  onClick={() => irA('facebook')}
                >
                  Facebook
                </CeldaNavegacionIos>
              </GrupoIos>

              <GrupoIos titulo="Inteligencia artificial">
                <CeldaNavegacionIos
                  icono={<IconoCeldaIos icono={Bot} color="violeta" />}
                  detalle={isAiConfigured ? 'Configurada' : 'Sin configurar'}
                  onClick={() => irA('ai')}
                >
                  IA
                </CeldaNavegacionIos>
                <CeldaNavegacionIos
                  icono={<IconoCeldaIos icono={ScrollText} color="naranja" />}
                  onClick={() => irA('logs')}
                >
                  Registro de la IA
                </CeldaNavegacionIos>
              </GrupoIos>

              <GrupoIos titulo="Chats">
                <CeldaNavegacionIos
                  icono={<IconoCeldaIos icono={Tag} color="turquesa" />}
                  detalle={tags.length > 0 ? String(tags.length) : undefined}
                  onClick={() => irA('tags')}
                >
                  Etiquetas
                </CeldaNavegacionIos>
              </GrupoIos>
            </>
          )}

          {/* WhatsApp */}
          {pantalla === 'whatsapp' && (
            <>
              <GrupoIos>
                <CeldaEstado
                  conectado={isConfigured}
                  texto={isConfigured ? 'Conectado' : 'Sin conectar'}
                  detalle={
                    isConfigured
                      ? 'Los mensajes de WhatsApp entran a Mensajería.'
                      : 'Seguí los dos pasos de abajo para conectar el número.'
                  }
                />
              </GrupoIos>

              <GrupoIos
                titulo="1. El webhook en Meta"
                pie={<>En Meta for Developers: WhatsApp → Configuración → Webhook. Suscribite al evento <Codigo>messages</Codigo>.</>}
              >
                <CeldaCopiable etiqueta="URL de devolución de llamada" valor={webhookUrl} onCopiar={() => copyToClipboard(webhookUrl, 'URL')} />
                <CeldaCopiable
                  etiqueta="Token de verificación"
                  valor={waConfig?.verify_token}
                  vacio="Se genera al guardar las credenciales."
                  onCopiar={() => waConfig?.verify_token && copyToClipboard(waConfig.verify_token, 'Token')}
                />
                <CeldaIos>
                  <span className={cn(TEXTO_PRINCIPAL, 'flex-1')}>Evento a suscribir</span>
                  <Codigo grande>messages</Codigo>
                </CeldaIos>
              </GrupoIos>

              <GrupoIos
                titulo="2. Las credenciales de la API"
                pie="El App Secret está en tu app de Meta → Configuración → Básica → Clave secreta de la app. Sirve para verificar que los mensajes vengan de Meta."
              >
                <CeldaCampoIos
                  etiqueta="Access Token"
                  secreto
                  placeholder="EAA…"
                  valor={configForm.whatsapp_access_token ?? ''}
                  onCambio={(v) => setConfigForm((prev) => ({ ...prev, whatsapp_access_token: v }))}
                />
                <CeldaCampoIos
                  etiqueta="Phone Number ID"
                  inputMode="numeric"
                  placeholder="1068552459672379"
                  valor={configForm.whatsapp_phone_id ?? ''}
                  onCambio={(v) => setConfigForm((prev) => ({ ...prev, whatsapp_phone_id: v }))}
                />
                <CeldaCampoIos
                  etiqueta="WhatsApp Business Account ID"
                  inputMode="numeric"
                  placeholder="868078746261917"
                  valor={configForm.whatsapp_business_id ?? ''}
                  onCambio={(v) => setConfigForm((prev) => ({ ...prev, whatsapp_business_id: v }))}
                />
                <CeldaCampoIos
                  etiqueta="App Secret"
                  secreto
                  placeholder="abc123…"
                  valor={configForm.app_secret ?? ''}
                  onCambio={(v) => setConfigForm((prev) => ({ ...prev, app_secret: v }))}
                />
              </GrupoIos>

              <GrupoIos>
                <CeldaAccionIos centrada onClick={handleSaveConfig} deshabilitada={savingConfig}>
                  {savingConfig ? 'Guardando…' : 'Guardar credenciales'}
                </CeldaAccionIos>
              </GrupoIos>

              <GrupoIos>
                <CeldaEnlace href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started">
                  La guía de la Cloud API de Meta
                </CeldaEnlace>
              </GrupoIos>
            </>
          )}

          {/* Instagram */}
          {pantalla === 'instagram' && (
            <>
              <GrupoIos>
                <CeldaEstado
                  conectado={isInstagramConfigured}
                  texto={isInstagramConfigured ? 'Conectado' : 'Sin conectar'}
                  detalle={
                    isInstagramConfigured
                      ? 'Los mensajes directos de Instagram entran a Mensajería.'
                      : 'Seguí los dos pasos de abajo para conectar la cuenta.'
                  }
                />
              </GrupoIos>

              <GrupoIos
                titulo="1. El webhook en Meta"
                pie={<>En Meta for Developers: Instagram → Webhooks. Suscribite al campo <Codigo>messages</Codigo>.</>}
              >
                <CeldaCopiable
                  etiqueta="URL de devolución de llamada"
                  valor={webhookUrlInstagram}
                  onCopiar={() => copyToClipboard(webhookUrlInstagram, 'URL')}
                />
                <CeldaCopiable
                  etiqueta="Token de verificación"
                  valor={igConfig?.verify_token}
                  vacio="Se genera al guardar las credenciales."
                  onCopiar={() => igConfig?.verify_token && copyToClipboard(igConfig.verify_token, 'Token')}
                />
              </GrupoIos>

              <GrupoIos
                titulo="2. Las credenciales de la API"
                pie="El Page ID es el de la página de Facebook conectada a tu cuenta de Instagram Business. El Account ID y el App Secret son opcionales."
              >
                <CeldaCampoIos
                  etiqueta="Facebook Page ID"
                  inputMode="numeric"
                  placeholder="123456789012345"
                  valor={igConfigForm.instagram_page_id}
                  onCambio={(v) => setIgConfigForm((prev) => ({ ...prev, instagram_page_id: v }))}
                />
                <CeldaCampoIos
                  etiqueta="Page Access Token"
                  secreto
                  placeholder="EAA…"
                  valor={igConfigForm.instagram_page_access_token}
                  onCambio={(v) => setIgConfigForm((prev) => ({ ...prev, instagram_page_access_token: v }))}
                />
                <CeldaCampoIos
                  etiqueta="Instagram Account ID"
                  inputMode="numeric"
                  placeholder="17841400000000000"
                  valor={igConfigForm.instagram_account_id}
                  onCambio={(v) => setIgConfigForm((prev) => ({ ...prev, instagram_account_id: v }))}
                />
                <CeldaCampoIos
                  etiqueta="App Secret"
                  secreto
                  placeholder="abc123…"
                  valor={igConfigForm.app_secret ?? ''}
                  onCambio={(v) => setIgConfigForm((prev) => ({ ...prev, app_secret: v }))}
                />
              </GrupoIos>

              <GrupoIos>
                <CeldaAccionIos centrada onClick={handleSaveIgConfig} deshabilitada={savingIgConfig}>
                  {savingIgConfig ? 'Guardando…' : 'Guardar credenciales'}
                </CeldaAccionIos>
              </GrupoIos>

              <GrupoIos titulo="Antes de empezar">
                {[
                  'Una cuenta de Instagram Business o Creator',
                  'La página de Facebook conectada a esa cuenta',
                  'Una app de Meta con el permiso instagram_manage_messages',
                  'El webhook del producto Instagram suscripto',
                ].map((r) => (
                  <CeldaIos key={r}>
                    <Check aria-hidden className="size-5 shrink-0 text-[var(--wa-accent)] lg:size-4" strokeWidth={2.4} />
                    <span className={cn(TEXTO_SECUNDARIO, 'flex-1 text-[var(--wa-text)]')}>{r}</span>
                  </CeldaIos>
                ))}
              </GrupoIos>
            </>
          )}

          {/* Facebook */}
          {pantalla === 'facebook' && (
            <VacioIos
              icono={Facebook}
              titulo="Facebook Messenger"
              texto="Muy pronto vas a poder conectar la página de Facebook y atender los mensajes de Messenger desde acá."
            >
              <span className="inline-flex h-8 items-center rounded-full bg-[var(--wa-raised)] px-3.5 text-[15px] font-medium text-[var(--wa-text-2)] lg:text-[13px]">
                Próximamente
              </span>
            </VacioIos>
          )}

          {/* IA */}
          {pantalla === 'ai' && (
            <>
              <GrupoIos>
                <CeldaEstado
                  conectado={isAiConfigured}
                  texto={isAiConfigured ? 'Configurada' : 'Sin configurar'}
                  detalle="Con una clave de OpenAI, de Anthropic o de OpenRouter andan los pasos de IA de las automatizaciones."
                />
              </GrupoIos>

              <GrupoIos titulo="OpenAI" pie={`Modelos: ${modelosDe('OpenAI')}.`}>
                <CeldaCampoIos
                  etiqueta="API key de OpenAI"
                  secreto
                  placeholder="sk-…"
                  valor={aiConfigForm.openai_api_key}
                  onCambio={(v) => setAiConfigForm((p) => ({ ...p, openai_api_key: v }))}
                />
              </GrupoIos>

              <GrupoIos titulo="Anthropic" pie={`Modelos: ${modelosDe('Anthropic')}.`}>
                <CeldaCampoIos
                  etiqueta="API key de Anthropic"
                  secreto
                  placeholder="sk-ant-…"
                  valor={aiConfigForm.anthropic_api_key}
                  onCambio={(v) => setAiConfigForm((p) => ({ ...p, anthropic_api_key: v }))}
                />
              </GrupoIos>

              <GrupoIos
                titulo="OpenRouter"
                pie="Cientos de modelos (Llama, Mistral, Gemini y más) a través de openrouter.ai, también gratuitos."
              >
                <CeldaCampoIos
                  etiqueta="API key de OpenRouter"
                  secreto
                  placeholder="sk-or-…"
                  valor={aiConfigForm.openrouter_api_key}
                  onCambio={(v) => setAiConfigForm((p) => ({ ...p, openrouter_api_key: v }))}
                />
              </GrupoIos>

              <GrupoIos
                titulo="Valores por defecto"
                pie="El prompt se usa en los pasos de IA que no tienen uno propio."
              >
                <CeldaModeloIos
                  etiqueta="Modelo"
                  valor={aiConfigForm.default_model}
                  onCambio={(id) => setAiConfigForm((p) => ({ ...p, default_model: id }))}
                />
                <CeldaCampoIos
                  etiqueta="Prompt del sistema"
                  multilinea
                  placeholder="Sos el asistente de la barbería. Respondé consultas sobre horarios, servicios y precios…"
                  valor={aiConfigForm.default_system_prompt}
                  onCambio={(v) => setAiConfigForm((p) => ({ ...p, default_system_prompt: v }))}
                />
              </GrupoIos>

              <GrupoIos>
                <CeldaAccionIos centrada onClick={handleSaveAiConfig} deshabilitada={savingAiConfig}>
                  {savingAiConfig ? 'Guardando…' : 'Guardar la configuración de IA'}
                </CeldaAccionIos>
              </GrupoIos>
            </>
          )}

          {/* Registro de la IA */}
          {pantalla === 'logs' && <AiLogsPanel />}

          {/* Etiquetas */}
          {pantalla === 'tags' && (
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

/** El estado de un canal: el ícono de color, «Conectado» y una línea de qué significa. */
function CeldaEstado({ conectado, texto, detalle }: { conectado: boolean; texto: string; detalle: string }) {
  return (
    <CeldaIos icono={<IconoCeldaIos icono={conectado ? Wifi : WifiOff} color={conectado ? 'verde' : 'naranja'} />}>
      <div className="min-w-0 flex-1">
        <p className={cn(TEXTO_PRINCIPAL, 'font-semibold')}>{texto}</p>
        <p className={TEXTO_SECUNDARIO}>{detalle}</p>
      </div>
    </CeldaIos>
  )
}

/** Un dato para copiar (la URL del webhook, el token): el nombre arriba, el valor y el botón de copiar. */
function CeldaCopiable({
  etiqueta,
  valor,
  vacio,
  onCopiar,
}: {
  etiqueta: string
  valor: string | null | undefined
  /** Lo que se lee mientras no hay valor. */
  vacio?: string
  onCopiar: () => void
}) {
  return (
    <li className={CLASE_CELDA}>
      <div className={cn(CLASE_CUERPO, 'py-1.5 pr-1.5 lg:py-1 lg:pr-1')}>
        <div className="min-w-0 flex-1 py-1">
          <p className="text-[13px] leading-[18px] text-[var(--wa-text-2)] lg:text-[12px] lg:leading-4">{etiqueta}</p>
          {valor ? (
            <p className="select-text truncate font-mono text-[15px] leading-[22px] text-[var(--wa-text)] lg:text-[13px] lg:leading-5">{valor}</p>
          ) : (
            <p className="text-[15px] leading-[22px] text-[var(--wa-text-2)] lg:text-[13px] lg:leading-5">{vacio}</p>
          )}
        </div>
        {valor && <BotonIconoIos etiqueta={`Copiar ${etiqueta.toLowerCase()}`} icono={Copy} onClick={onCopiar} tono="acento" />}
      </div>
    </li>
  )
}

/** Un enlace afuera (la guía de Meta), en verde y con la flecha de «se abre aparte». */
function CeldaEnlace({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li className={CLASE_CELDA}>
      <div className="flex min-h-11 min-w-0 flex-1 items-stretch pr-4 lg:min-h-10 lg:pr-3">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="relative flex min-w-0 flex-1 items-center gap-3 py-2.5 text-[17px] text-[var(--wa-accent)] outline-none [-webkit-tap-highlight-color:transparent] before:absolute before:inset-0 before:-left-4 before:-right-4 before:transition-colors active:before:bg-white/[0.08] focus-visible:before:ring-2 focus-visible:before:ring-inset focus-visible:before:ring-[var(--wa-accent)] lg:py-2 lg:text-[14px] lg:hover:before:bg-white/[0.04]"
        >
          <span className="min-w-0 flex-1 truncate">{children}</span>
          <ExternalLink aria-hidden className="size-[18px] shrink-0 lg:size-4" />
          <span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
      </div>
    </li>
  )
}

function Codigo({ children, grande = false }: { children: ReactNode; grande?: boolean }) {
  return (
    <code
      className={cn(
        'rounded-[6px] bg-[var(--wa-raised-2)] px-1.5 py-px font-mono text-[var(--wa-accent)]',
        grande ? 'text-[15px] lg:text-[13px]' : 'text-[13px] lg:text-[12px]',
      )}
    >
      {children}
    </code>
  )
}
