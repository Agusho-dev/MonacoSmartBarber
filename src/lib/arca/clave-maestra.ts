// =============================================================================
// src/lib/arca/clave-maestra.ts
//
// La clave maestra se mudó a `src/lib/crypto/secretos.ts`: dejó de ser algo de
// ARCA cuando las señas de Mercado Pago empezaron a cifrar los access_token de
// cada sucursal con la misma clave. Este archivo queda como fachada para no
// tocar los call-sites que ya la importan desde acá.
//
// El secreto de Vault SIGUE llamándose `arca_encryption_key` aunque ahora lo
// compartan dos features. Renombrarlo dejaría ilegible todo lo que ya está
// cifrado en `arca_taxpayers` —las claves privadas de cuatro certificados
// fiscales—, y recuperar eso significa rehacer el trámite en ARCA. El nombre
// es histórico; el uso es general.
// =============================================================================

export {
    claveMaestra,
    hayClaveDeCifrado,
    olvidarClaveEnMemoria,
} from '@/lib/crypto/secretos'
