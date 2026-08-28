import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"

const APP = join(process.cwd(), "src/app")
const DRY = process.argv.includes("--dry")

const MAP: Record<string, string> = {
  "alpha-engine": "AlphaEnginePageContent",
  "calendar": "CalendarPageContent",
  "correlations": "CorrelationsPageContent",
  "cycle-indicators": "CycleIndicatorsPageContent",
  "defi": "DeFiPageContent",
  "dex": "DexMonitorPageContent",
  "entities": "EntitiesPageContent",
  "indonesia-macro": "IndonesiaMacroContent",
  "infra-signals": "InfraSignalsPageContent",
  "insider": "InsiderPageContent",
  "macro": "MacroCommandCenterContent",
  "mempool": "MempoolPageContent",
  "news-feed": "NewsFeedContent",
  "prediction-markets": "PredictionMarketsPageContent",
  "predictions": "PredictionsPageContent",
  "revenue": "RevenuePageContent",
  "rugcheck": "RugcheckPageContent",
}

function findDefaultBlock(src: string) {
  const m = /export\s+default\s+function\s+([A-Za-z_]\w*)?\s*\(/.exec(src)
  if (!m) return null
  const name = m[1] || "Page"
  const start = m.index
  let i = src.indexOf("{", m.index)
  if (i < 0) return null
  let depth = 0
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) {
        i++
        break
      }
    }
  }
  return { start, end: i, name }
}

function extractWrapper(defBlock: string, named: string) {
  const ret = /return\s*(?:\(|<)\s*(<([A-Z]\w*)([^>]*)>)/.exec(defBlock)
  if (ret) return `<${ret[2]}${ret[3]}><${named} /></${ret[2]}>`
  return `<${named} />`
}

for (const [dir, named] of Object.entries(MAP)) {
  const pagePath = join(APP, dir, "page.tsx")
  if (!existsSync(pagePath)) {
    console.error(`SKIP ${dir}: missing page.tsx`)
    continue
  }
  const src = readFileSync(pagePath, "utf8")
  const block = findDefaultBlock(src)
  if (!block) {
    console.error(`SKIP ${dir}: no default export`)
    continue
  }
  // Drop ONLY the default-export function block; keep everything else (imports, named Content, Inner).
  const content = src.slice(0, block.start) + src.slice(block.end)
  if (!new RegExp(`export\\s+(function|const)\\s+${named}\\b`).test(content)) {
    console.error(`SKIP ${dir}: named export ${named} absent after split`)
    continue
  }
  const wrapper = extractWrapper(src.slice(block.start, block.end), named)
  const pageOut =
    `"use client";\n` +
    `import { ${named} } from "./content";\n\n` +
    `export default function ${block.name}() {\n` +
    `  return ${wrapper};\n}\n`

  if (DRY) {
    console.log(`DRY ${dir}: block=${block.name} wrapper=${wrapper}`)
    continue
  }
  writeFileSync(join(APP, dir, "content.tsx"), content)
  writeFileSync(pagePath, pageOut)
  console.log(`OK ${dir}`)
}
console.log("DONE")
