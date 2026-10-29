// node --import ./cargador.mjs simular.ts
import { register } from 'node:module'
register('./ganchos.mjs', import.meta.url)
