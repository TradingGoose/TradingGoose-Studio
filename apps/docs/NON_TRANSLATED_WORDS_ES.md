# Reporte de texto no traducido en la documentación en español

Fecha de auditoría: 2026-08-27

Estado de remediación: corregidos los hallazgos de alta probabilidad el 2026-08-27.

> Este documento conserva el resultado inicial como registro de auditoría. Los 80 hallazgos de su escaneo conservador se revisaron y corrigieron cuando correspondían a prosa. Una auditoría léxica posterior, más amplia, detectó 153 coincidencias adicionales que requieren revisión contextual; por tanto, este trabajo no certifica todavía la traducción completa del locale español. La validación estructural sí finaliza correctamente.

## Alcance

- Directorio revisado: `content/docs/es`
- Archivos en español: 239 MDX
- Archivos de referencia en inglés: 239 MDX
- La estructura de archivos entre `en` y `es` está completa.
- Este reporte se centra en prosa visible para el usuario. No considera errores los nombres de producto, nombres de API, identificadores, código, comandos, rutas, claves JSON ni valores enumerados que deban conservarse.

## Resultado

La auditoría inicial detectó texto sin traducir y traducciones híbridas. El escaneo conservador identificó 80 líneas de alta probabilidad distribuidas en 40 archivos. Esos hallazgos se utilizaron como lista de control y ya fueron corregidos. Las cifras se conservan a continuación como referencia histórica.

### Palabras inglesas detectadas en prosa candidata

Los conteos siguientes corresponden únicamente al conjunto conservador de 80 líneas. Una aparición puede ser válida si forma parte de un identificador o valor técnico; por eso la corrección debe hacerse revisando la línea completa.

| Palabra | Apariciones | Palabra | Apariciones | Palabra | Apariciones |
| --- | ---: | --- | ---: | --- | ---: |
| get | 17 | at | 11 | not | 10 |
| if | 9 | where | 9 | all | 7 |
| include | 6 | last | 5 | select | 5 |
| as | 4 | on | 4 | follow | 4 |
| be | 4 | the | 3 | and | 3 |
| its | 3 | is | 3 | return | 3 |
| provide | 3 | of | 3 | creating | 3 |
| once | 3 | each | 3 | set | 2 |
| between | 2 | in | 2 | only | 2 |
| can | 2 | about | 2 | more | 2 |
| using | 2 | first | 2 | are | 2 |
| than | 2 | what | 2 | it | 1 |
| want | 1 | click | 1 | run | 1 |
| needs | 1 | including | 1 | add | 1 |
| choose | 1 | this | 1 | from | 1 |
| does | 1 | also | 1 | use | 1 |
| adding | 1 | do | 1 | for | 1 |
| running | 1 | new | 1 | allow | 1 |
| how | 1 | both | 1 | make | 1 |

Además de esas palabras funcionales, la revisión visual encontró vocabulario inglés usado como prosa: `access`, `accounts`, `agent`, `analyzing`, `array`, `browser`, `companies`, `condition`, `configuration`, `contacts`, `data`, `detailed`, `documents`, `domain`, `email`, `folder`, `index`, `integrate`, `operation`, `pagination`, `path`, `powerful`, `required`, `search`, `services`, `status`, `supports`, `task`, `tool`, `tools`, `trigger`, `usage`, `workflow` y `workflows`. Algunos de estos términos pueden conservarse en nombres propios o contratos técnicos, pero no cuando sustituyen prosa española normal.

## Archivos con mayor número de líneas candidatas

| Archivo | Líneas candidatas |
| --- | ---: |
| `tools/incidentio.mdx` | 10 |
| `tools/apollo.mdx` | 6 |
| `tools/ahrefs.mdx` | 6 |
| `tools/index.mdx` | 6 |
| `tools/gitlab.mdx` | 5 |
| `tools/datadog.mdx` | 4 |
| `tools/hunter.mdx` | 3 |
| `triggers/manual.mdx` | 2 |
| `tools/zendesk.mdx` | 2 |
| `tools/elasticsearch.mdx` | 2 |
| `tools/asana.mdx` | 2 |
| `tools/postgresql.mdx` | 2 |
| `tools/dropbox.mdx` | 2 |
| `tools/mysql.mdx` | 2 |

Otros archivos con al menos una línea candidata:

`utilities/custom-tools.mdx`, `triggers/webhook.mdx`, `blocks/router.mdx`, `blocks/response.mdx`, `blocks/api.mdx`, `blocks/wait.mdx`, `blocks/human_in_the_loop.mdx`, `blocks/parallel.mdx`, `blocks/memory.mdx`, `copilot/index.mdx`, `tools/salesforce.mdx`, `tools/arxiv.mdx`, `tools/mailchimp.mdx`, `tools/google_slides.mdx`, `tools/grain.mdx`, `tools/exa.mdx`, `tools/youtube.mdx`, `tools/cursor.mdx`, `tools/browser_use.mdx`, `tools/intercom.mdx`, `tools/x.mdx`, `tools/wikipedia.mdx`, `tools/supabase.mdx`, `tools/grafana.mdx`, `tools/huggingface.mdx` y `tools/calendly.mdx`.

## Hallazgos confirmados representativos

| Ubicación | Texto encontrado | Problema |
| --- | --- | --- |
| `triggers/webhook.mdx:40` | `Get Webhook URL — Copy the automatically generated unique endpoint` | Frase completa sin traducir. |
| `triggers/manual.mdx:17` | `El Manual trigger... Usar it cuando tú want...` | Traducción híbrida e ininteligible. |
| `triggers/manual.mdx:20` | `Sin configuración needed — solo click Run.` | Palabras de prosa sin traducir. |
| `blocks/router.mdx:216` | `Router analyzes company size, industry, and needs` | Frase completa sin traducir. |
| `blocks/response.mdx:49` | `Set Status Codes: Configure appropriate HTTP status codes...` | Título y descripción sin traducir. |
| `blocks/api.mdx:51` | `Handle authentication: Support various auth methods...` | Título y descripción sin traducir. |
| `blocks/wait.mdx:38` | `Add time delays: Pause execution between workflow steps` | Título y descripción sin traducir. |
| `blocks/parallel.mdx:152` | `Parallel Type: Choose between 'count' or 'collection'` | Prosa sin traducir; los valores técnicos pueden conservarse. |
| `copilot/index.mdx:82` | `Today, Yesterday, This Week, Last Week, Older` | Etiquetas visibles sin traducir; revisar si reflejan literalmente la UI. |
| `tools/arxiv.mdx:345` | `Integrates ArXiv... search... get... Does not require...` | Párrafo híbrido. |
| `tools/grain.mdx:935` | `Integrate Grain... Access... Can also trigger...` | Párrafo híbrido. |
| `tools/elasticsearch.mdx:1770` | `todos its documents... operation is irreversible` | Advertencia crítica parcialmente sin traducir. |
| `tools/incidentio.mdx:775` | `detailed información about... por its ID` | Descripción híbrida. |
| `tools/datadog.mdx:300` | `Use para analyzing trends, creating reports...` | Descripción híbrida. |
| `tools/cursor.mdx:710` | `Interact... launch... work... Supports launching...` | Párrafo mayoritariamente en inglés. |
| `tools/intercom.mdx:1521` | `todos companies... pagination support... larger than...` | Párrafo híbrido. |
| `tools/index.mdx:10` | `Tools are powerful components... allow... interact...` | Introducción principal mayoritariamente sin traducir. |
| `tools/browser_use.mdx:147` | `What debe el browser agent do` | Descripción de campo híbrida. |
| `tools/mysql.mdx:457` | `WHERE clause condition (without WHERE keyword)` | Explicación sin traducir; `WHERE` debe conservarse. |
| `tools/huggingface.mdx:150` | `Higher values make output more random` | Explicación sin traducir. |

## Falsos positivos que no deben traducirse automáticamente

- Métodos y protocolos: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HTTP`, `API`, `SDK`, `MCP`.
- Productos y servicios: `TradingGoose`, `PineTS`, `GitHub`, `HubSpot`, `Datadog`, `Apollo`, etc.
- Identificadores y claves: `first_name`, `created_at`, `last_activity_at`, `single_select`, `user_id`.
- Consultas y palabras reservadas: `SELECT`, `FROM`, `WHERE`, `LIMIT`.
- Valores enumerados exigidos por una API: `running`, `success`, `failed`, `count`, `collection`, cuando representan el valor literal enviado al servicio.
- Código, comandos, rutas, URLs, variables de entorno y contenido dentro de bloques de código.

## Conclusión

Los 80 hallazgos iniciales fueron revisados en contexto y corregidos cuando correspondían a prosa visible. No se hicieron reemplazos globales porque términos como `get`, `where`, `last` o `running` pueden formar parte de contratos técnicos válidos. La pasada ampliada posterior aún registra 153 coincidencias de alta confianza —incluido texto visible incrustado en JSON/JSX—, que deben revisarse antes de certificar como completa toda la traducción española.
