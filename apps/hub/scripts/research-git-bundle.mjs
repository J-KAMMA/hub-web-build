import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';

const exec = promisify(execFile);
export const MAX_GIT_BUNDLE = 50 * 1024 * 1024;

// A self-contained Git bundle carries reachable history and refs, never server
// configuration, hooks, credentials, reflogs, or the working directory.
export async function bundleResearchRepository({repo, env, flags, signal}) {
  const options = {env, windowsHide: true, timeout: 20000, signal};
  try {
    await exec('git', [...flags, `--git-dir=${repo}`, 'show-ref', '--quiet'], options);
  } catch (error) {
    if (error.code === 1) throw Object.assign(Error('repository_empty'), {status: 409});
    throw error;
  }
  try {
    const {stdout} = await exec('git', [...flags, `--git-dir=${repo}`, 'bundle', 'create', '--version=3', '-', '--all'],
      {...options, encoding: 'buffer', maxBuffer: MAX_GIT_BUNDLE});
    return {bytes: stdout, sha256: createHash('sha256').update(stdout).digest('hex')};
  } catch (error) {
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw Object.assign(Error('bundle_too_large'), {status: 413});
    throw error;
  }
}
