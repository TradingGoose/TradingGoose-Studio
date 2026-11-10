import path from 'node:path'

// One cached server path shared by actual IO and the private storage boundary, without initialization.
const PROJECT_ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd())
export const UPLOAD_DIR_SERVER = path.join(PROJECT_ROOT, 'uploads')
