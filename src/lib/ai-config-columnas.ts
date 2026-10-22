import 'server-only'

// =============================================================================
// src/lib/ai-config-columnas.ts
// Las columnas de `organization_ai_config` que puede recibir el navegador de
// Mensajería (la pestaña IA de su configuración y el auto-etiquetado).
//
// Vive en un módulo SIN 'use server': un archivo 'use server' sólo puede
// exportar funciones async, y una constante ahí rompe el build.
//
// POR QUÉ UNA LISTA Y NO `select('*')`
// La fila tiene la clave de Anthropic de Tex CIFRADA (`anthropic_api_key_cifrada`,
// mig 227, "nunca viaja al navegador") y la configuración de Tex (`assistant_*`).
// /dashboard/mensajeria pasaba la fila entera a un componente cliente y
// `saveOrgAiConfig` la devolvía entera después de guardar: las dos cosas
// terminaban en el payload del navegador. Una columna nueva de esa tabla NO
// tiene que aparecer acá salvo que Mensajería la necesite de verdad.
//
// Las claves en texto plano (openai/anthropic/openrouter) siguen, a propósito:
// el formulario de la pestaña IA arranca con ellas y `saveOrgAiConfig` convierte
// un campo vacío en null, así que sacarlas borraría la clave de OpenAI de prod en
// el próximo "Guardar". Pasarlas a booleanos de presencia es otro cambio (con
// el formulario mandando sólo lo que se editó).
// =============================================================================

// Con este literal supabase-js infiere una fila SIN las columnas `assistant_*` que declara
// `OrgAiConfig` (Mensajería no las lee): quien la recibe la convierte a `OrgAiConfig`.
export const COLUMNAS_AI_CONFIG_MENSAJERIA =
  'id, organization_id, openai_api_key, anthropic_api_key, openrouter_api_key, default_model, default_system_prompt, default_temperature, default_max_tokens, is_active, auto_tag_enabled, auto_tag_model, created_at, updated_at'
