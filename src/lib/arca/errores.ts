// =============================================================================
// src/lib/arca/errores.ts
// Traducción de los errores de ARCA a algo que un dueño de barbería pueda
// accionar.
//
// ARCA contesta cosas como `(600) ValidacionDeToken: No apareció CUIT en lista
// de relaciones`. Eso no le dice nada a nadie. Cada entrada de acá tiene tres
// partes deliberadas: QUÉ pasó, DE QUIÉN es el problema, y QUÉ hacer ahora.
//
// El campo `culpa` importa más de lo que parece: le sirve a la UI para decidir
// el tono. Un problema de ARCA no se muestra en rojo alarmante — se muestra
// como "esperá, no sos vos".
// =============================================================================

export type CulpaError = 'usuario' | 'arca' | 'sistema'

export interface ErrorTraducido {
    titulo: string
    detalle: string
    accion?: string
    culpa: CulpaError
    /** true si reintentar el mismo pedido más tarde tiene sentido. */
    reintentable: boolean
    /** Código crudo, para el detalle técnico plegable y los logs. */
    codigo: string
}

// -----------------------------------------------------------------------------
// WSAA
// -----------------------------------------------------------------------------
const WSAA: Record<string, Omit<ErrorTraducido, 'codigo'>> = {
    'coe.notAuthorized': {
        titulo: 'ARCA todavía no reconoce la autorización',
        detalle:
            'El certificado es válido pero no tiene habilitado el servicio de Facturación Electrónica para este CUIT.',
        accion:
            'En ARCA, entrá a "Administrador de Relaciones de Clave Fiscal" → Nueva Relación → Facturación Electrónica, ' +
            'y asociá el certificado. Si lo hiciste recién, puede tardar unos minutos en propagarse.',
        culpa: 'usuario',
        reintentable: true,
    },
    'coe.alreadyAuthenticated': {
        titulo: 'ARCA ya tiene una sesión abierta',
        detalle:
            'ARCA no permite abrir dos sesiones con el mismo certificado. Ya hay una activa y hay que esperar a que libere.',
        accion: 'Se resuelve solo. Probá de nuevo en un par de minutos.',
        culpa: 'sistema',
        reintentable: true,
    },
    'cms.cert.expired': {
        titulo: 'El certificado venció',
        detalle: 'El certificado digital que usamos para facturar llegó a su fecha de vencimiento.',
        accion: 'Hay que generar uno nuevo y volver a cargarlo desde la configuración del facturador.',
        culpa: 'usuario',
        reintentable: false,
    },
    'cms.cert.untrusted': {
        titulo: 'El certificado no es de este ambiente',
        detalle:
            'Estás usando un certificado de pruebas (homologación) contra producción, o al revés. ARCA los trata como ' +
            'autoridades distintas y no acepta el cruce.',
        accion: 'Volvé a generar el certificado en el ambiente correcto.',
        culpa: 'usuario',
        reintentable: false,
    },
    'cms.cert.invalid': {
        titulo: 'El certificado no es válido',
        detalle: 'ARCA no pudo validar el certificado cargado.',
        accion: 'Verificá que hayas subido el archivo .crt que descargaste de ARCA y no otro.',
        culpa: 'usuario',
        reintentable: false,
    },
    'cms.cert.notFound': {
        titulo: 'Falta el certificado en la firma',
        detalle: 'La firma se armó sin certificado adentro.',
        accion: 'Volvé a cargar el certificado en la configuración del facturador.',
        culpa: 'sistema',
        reintentable: false,
    },
    'cms.sign.invalid': {
        titulo: 'La firma no coincide con el certificado',
        detalle: 'El certificado cargado no corresponde a la clave privada que generamos.',
        accion: 'Generá un pedido de certificado nuevo desde el facturador y subí el .crt que salga de ese pedido.',
        culpa: 'usuario',
        reintentable: false,
    },
    'cms.bad': {
        titulo: 'ARCA no pudo leer la firma',
        detalle: 'El paquete firmado llegó mal formado.',
        culpa: 'sistema',
        reintentable: true,
    },
    'xml.generationTime.invalid': {
        titulo: 'Problema con la hora del servidor',
        detalle: 'ARCA rechazó el pedido porque la hora de nuestro servidor está corrida respecto de la suya.',
        accion: 'Es un problema nuestro. Probá de nuevo en unos minutos.',
        culpa: 'sistema',
        reintentable: true,
    },
    'wsaa.unavailable': {
        titulo: 'ARCA no está disponible',
        detalle: 'El servicio de autenticación de ARCA está caído.',
        accion: 'No es tu configuración. Probá más tarde.',
        culpa: 'arca',
        reintentable: true,
    },
    'wsn.unavailable': {
        titulo: 'El servicio de facturación de ARCA no responde',
        detalle: 'ARCA reporta el servicio como no disponible.',
        culpa: 'arca',
        reintentable: true,
    },
    red: {
        titulo: 'No pudimos conectarnos con ARCA',
        detalle: 'La conexión con los servidores de ARCA falló o tardó demasiado.',
        accion: 'Los servidores de ARCA se caen seguido. Probá de nuevo en unos minutos.',
        culpa: 'arca',
        reintentable: true,
    },
}

// -----------------------------------------------------------------------------
// WSFEv1
// -----------------------------------------------------------------------------
const WSFE: Record<number, Omit<ErrorTraducido, 'codigo'>> = {
    600: {
        titulo: 'ARCA no reconoce la autorización',
        detalle:
            'El token es válido pero este CUIT no figura entre los que el certificado puede representar; ' +
            'o el servicio de Facturación Electrónica no está habilitado.',
        accion:
            'Revisá en ARCA que la relación esté creada para el servicio "Facturación Electrónica" ' +
            '(ojo: no es el de exportación) y para este CUIT.',
        culpa: 'usuario',
        reintentable: true,
    },
    601: {
        titulo: 'El CUIT no coincide',
        detalle: 'El CUIT que estamos usando para facturar no es uno de los que ese certificado puede representar.',
        accion: 'Verificá el CUIT cargado en la configuración del facturador.',
        culpa: 'usuario',
        reintentable: false,
    },
    602: {
        titulo: 'Sin datos en ARCA',
        detalle: 'ARCA no encontró registros para esa consulta.',
        culpa: 'arca',
        reintentable: false,
    },
    500: {
        titulo: 'Error interno de ARCA',
        detalle: 'ARCA tuvo un problema propio procesando el pedido.',
        accion: 'No reemitas el comprobante: puede haber quedado autorizado. El sistema lo va a verificar solo.',
        culpa: 'arca',
        reintentable: true,
    },
    501: {
        titulo: 'Error de base de datos de ARCA',
        detalle: 'La base de ARCA rechazó la operación.',
        accion: 'No reemitas el comprobante. Probá de nuevo en unos minutos.',
        culpa: 'arca',
        reintentable: true,
    },
    502: {
        titulo: 'ARCA está saturada',
        detalle: 'El autorizador de CAE de ARCA está con problemas.',
        accion: 'Probá de nuevo en unos minutos.',
        culpa: 'arca',
        reintentable: true,
    },
    10005: {
        titulo: 'El punto de venta no está autorizado',
        detalle: 'ARCA no reconoce ese punto de venta para facturar por Web Services.',
        accion:
            'En ARCA: "Administración de puntos de venta y domicilios" → A/B/M → Alta. ' +
            'Elegí el sistema de Web Services que corresponde a tu condición fiscal, no "Comprobantes en línea".',
        culpa: 'usuario',
        reintentable: false,
    },
    11002: {
        titulo: 'El punto de venta no está habilitado',
        detalle: 'El punto de venta existe pero no está habilitado para emitir.',
        accion: 'Revisalo en ARCA, en "Administración de puntos de venta y domicilios".',
        culpa: 'usuario',
        reintentable: false,
    },
    10015: {
        titulo: 'Falta identificar al cliente',
        detalle: 'Por el importe del comprobante, ARCA exige los datos del comprador.',
        accion: 'Cargá el DNI o CUIT del cliente y volvé a emitir.',
        culpa: 'usuario',
        reintentable: false,
    },
    10016: {
        titulo: 'La numeración se desincronizó',
        detalle:
            'El número o la fecha del comprobante no son los que ARCA espera. Suele pasar cuando se facturó por ' +
            'otro sistema con el mismo punto de venta, o cuando la fecha quedó fuera de la ventana permitida.',
        accion: 'El sistema vuelve a leer el último número autorizado y reintenta solo.',
        culpa: 'sistema',
        reintentable: true,
    },
    10048: {
        titulo: 'Los importes no cierran',
        detalle: 'La suma de los importes no coincide con el total, según la validación de ARCA.',
        culpa: 'sistema',
        reintentable: false,
    },
    10049: {
        titulo: 'Faltan las fechas del servicio',
        detalle: 'Al facturar servicios, ARCA exige el período de prestación y el vencimiento de pago.',
        culpa: 'sistema',
        reintentable: false,
    },
    10070: {
        titulo: 'Falta el detalle de IVA',
        detalle: 'ARCA exige informar el desglose de IVA cuando el neto es mayor a cero.',
        culpa: 'sistema',
        reintentable: false,
    },
    10071: {
        titulo: 'Sobra el detalle de IVA',
        detalle: 'En una Factura C no se informa IVA, y se está mandando.',
        accion: 'Verificá que la condición fiscal cargada sea la correcta.',
        culpa: 'sistema',
        reintentable: false,
    },
    10246: {
        titulo: 'Falta la condición de IVA del cliente',
        detalle:
            'Desde septiembre de 2026 ARCA exige informar la condición frente al IVA del receptor en cada comprobante.',
        culpa: 'sistema',
        reintentable: false,
    },
}

const GENERICO: Omit<ErrorTraducido, 'codigo'> = {
    titulo: 'ARCA rechazó el comprobante',
    detalle: 'ARCA devolvió un error que todavía no tenemos traducido.',
    accion: 'Mirá el detalle técnico y, si se repite, pasáselo a tu contador.',
    culpa: 'arca',
    reintentable: false,
}

/**
 * Traduce un error de ARCA.
 *
 * Acepta el código numérico de WSFEv1, el string de WSAA (`coe.notAuthorized`),
 * o el mensaje crudo — del que intenta extraer un código entre paréntesis, que
 * es como los devuelve ARCA (`(600) ValidacionDeToken: ...`).
 */
export function traducirErrorArca(
    codigo: number | string | null | undefined,
    mensajeCrudo?: string | null,
): ErrorTraducido {
    const crudo = String(codigo ?? '')

    if (typeof codigo === 'number' && WSFE[codigo]) {
        return { ...WSFE[codigo], codigo: crudo }
    }
    if (typeof codigo === 'string') {
        const wsaa = WSAA[codigo]
        if (wsaa) return { ...wsaa, codigo: crudo }
        const soloNumero = Number(codigo)
        if (Number.isFinite(soloNumero) && WSFE[soloNumero]) {
            return { ...WSFE[soloNumero], codigo: crudo }
        }
    }

    // Último intento: pescar el código adentro del mensaje.
    if (mensajeCrudo) {
        const nEnParentesis = mensajeCrudo.match(/\((\d{3,5})\)/)?.[1]
        if (nEnParentesis && WSFE[Number(nEnParentesis)]) {
            return { ...WSFE[Number(nEnParentesis)], codigo: nEnParentesis }
        }
        const nAlInicio = mensajeCrudo.match(/^(\d{3,5})\s*[:.]/)?.[1]
        if (nAlInicio && WSFE[Number(nAlInicio)]) {
            return { ...WSFE[Number(nAlInicio)], codigo: nAlInicio }
        }
        const wsaaCod = mensajeCrudo.match(/((?:coe|cms|xml|wsn|wsaa)\.[A-Za-z.]+)/)?.[1]
        if (wsaaCod && WSAA[wsaaCod]) {
            return { ...WSAA[wsaaCod], codigo: wsaaCod }
        }
    }

    return {
        ...GENERICO,
        detalle: mensajeCrudo?.trim() || GENERICO.detalle,
        codigo: crudo || 'desconocido',
    }
}

/**
 * El mensaje del punto de venta de CONTINGENCIA (CAEA).
 *
 * Se usa en dos lugares y tiene que decir exactamente lo mismo en los dos: en
 * el wizard (cuando ARCA devuelve sólo puntos CAEA) y en la emisión (cuando ya
 * hay uno guardado y el motor se niega a usarlo). Que sea una sola función es
 * lo que garantiza que el dueño no lea dos explicaciones distintas del mismo
 * problema según por dónde entró.
 */
export function errorPuntoVentaContingencia(
    numeros: number[],
    emisionTipo?: string | null,
): ErrorTraducido {
    const lista = numeros.length
        ? numeros.map((n) => `N° ${String(n).padStart(5, '0')}`).join(', ')
        : 'el punto de venta cargado'
    return {
        titulo: 'El punto de venta es de contingencia y no sirve para facturar',
        detalle:
            `ARCA tiene ${lista} dado de alta como ` +
            `${emisionTipo?.trim() ? `"${emisionTipo.trim()}"` : 'CAEA (contingencia)'}. ` +
            'Ese tipo sirve sólo para el régimen de contingencia, donde el código se pide por adelantado para ' +
            'una quincena entera. Para facturar corte por corte hace falta uno de Web Services (CAE / RECE). ' +
            'Es un cambio que sólo se puede hacer en ARCA: mientras siga así, cada comprobante va a salir ' +
            'rechazado con el error 10005.',
        accion:
            'En ARCA: "Administración de puntos de venta y domicilios" → clic en el nombre → ' +
            'A/B/M de puntos de venta → Agregar, y elegí el sistema de Web Services que corresponde a tu ' +
            'condición fiscal (para monotributo aparece como "CAE - Monotributo"). Usá un número NUEVO, sin ' +
            'ventas previas. Cuando lo tengas, volvé acá y apretá "Probar conexión".',
        culpa: 'usuario',
        reintentable: false,
        codigo: 'punto_venta_contingencia',
    }
}

/**
 * Interpreta el resultado de `FEParamGetPtosVenta` para el checklist del wizard.
 * Un array vacío NO es un error técnico: es el diagnóstico más frecuente y el
 * más fácil de arreglar.
 *
 * Recibe la lista y no dos contadores porque los tres casos se distinguen por
 * el MOTIVO de que no sirvan, y el motivo está en cada punto de venta. Con
 * `(cantidad, utilizables)` el caso más caro de todos —el punto de venta de
 * contingencia— caía en el cajón de "bloqueados o dados de baja" y mandaba al
 * usuario a revisar algo que estaba perfecto.
 */
export function diagnosticoPuntosVenta(
    puntos: { numero: number; emisionTipo: string; bloqueado: boolean; fechaBaja: string | null; sirveParaCae: boolean }[],
): ErrorTraducido | null {
    if (puntos.some((p) => !p.bloqueado && !p.fechaBaja && p.sirveParaCae)) return null

    if (puntos.length === 0) {
        return {
            titulo: 'Todavía no hay ningún punto de venta',
            detalle: 'ARCA respondió bien, pero este CUIT no tiene puntos de venta dados de alta para Web Services.',
            accion:
                'En ARCA: "Administración de puntos de venta y domicilios" → clic en el nombre de la empresa → ' +
                'A/B/M de puntos de venta → Agregar. Es importante que sea uno NUEVO, sin ventas previas.',
            culpa: 'usuario',
            reintentable: true,
            codigo: 'sin_puntos_venta',
        }
    }

    // Vivos pero de contingencia: el caso de Monaco. Se diagnostica antes que
    // "bloqueados" porque es el único que se arregla dando de alta OTRO punto
    // de venta en vez de desbloquear el que ya está.
    const contingencia = puntos.filter((p) => !p.bloqueado && !p.fechaBaja && !p.sirveParaCae)
    if (contingencia.length) {
        return errorPuntoVentaContingencia(
            contingencia.map((p) => p.numero),
            contingencia[0]?.emisionTipo,
        )
    }

    return {
        titulo: 'Los puntos de venta están bloqueados o dados de baja',
        detalle: `ARCA devolvió ${puntos.length} punto(s) de venta, pero ninguno está en condiciones de emitir.`,
        accion: 'Revisalos en ARCA o dá de alta uno nuevo.',
        culpa: 'usuario',
        reintentable: true,
        codigo: 'puntos_venta_bloqueados',
    }
}

/**
 * ¿Este error se va a repetir igual en la próxima venta del lote?
 *
 * La distinción es la que separa "seguir con las otras 34" de "cortar acá":
 *
 *   · Errores de la VENTA (ya facturada, importe en cero, sumas que no cierran)
 *     son de esa venta: la siguiente puede salir perfecta.
 *   · Errores de la CONFIGURACIÓN o del SERVICIO (certificado, autorización,
 *     punto de venta, ARCA caída) no dependen de la venta: insistir 34 veces
 *     produce 34 errores idénticos, 34 filas de basura en el historial y 68
 *     llamadas al pedo a un servidor que ya dijo que no.
 *
 * El caso que lo hizo evidente: un punto de venta de contingencia devolvía
 * 10005 en cada intento y el motor seguía martillando.
 */
export function errorCortaElLote(codigo: string | null | undefined): boolean {
    if (!codigo) return false
    const c = String(codigo)

    // Códigos propios del motor.
    if (
        [
            'sin_punto_venta',
            'punto_venta_contingencia',
            'sin_contribuyente',
            'reserva',
            'timeout',
            'red',
        ].includes(c)
    ) {
        return true
    }

    // Todo lo de WSAA es del certificado o de la autorización: nunca de la venta.
    if (/^(coe|cms|xml|wsn|wsaa)\./.test(c)) return true

    // WSFEv1: servicio caído, autorización, y los rechazos de configuración.
    const n = Number(c)
    if (Number.isFinite(n)) {
        return [500, 501, 502, 600, 601, 602, 10005, 11002, 10016].includes(n)
    }
    return false
}
