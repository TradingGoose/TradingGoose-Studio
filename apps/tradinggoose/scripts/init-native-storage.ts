import { createNativeStorage } from '../lib/mastra/runtime'

const ownerUrl = process.env.MASTRA_OWNER_DATABASE_URL
if (!ownerUrl)
  throw new Error('MASTRA_OWNER_DATABASE_URL is required for deployment initialization')
const native = createNativeStorage(ownerUrl, true)
try {
  await native.storage.init()
  await native.verifyCapabilities()
} finally {
  await native.close()
}
