import { createRuntime } from '../server/src/runtime.js';

// Vercel invokes Express directly; it must never open a listening socket here.
const runtime = createRuntime(true);
export default runtime.app;
