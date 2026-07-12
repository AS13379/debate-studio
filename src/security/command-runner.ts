import { spawn } from 'node:child_process'

export interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface CommandRunner {
  run(command: string, args: readonly string[], stdin?: string): Promise<CommandResult>
}

export class ProcessCommandRunner implements CommandRunner {
  run(command: string, args: readonly string[], stdin?: string): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let settled = false

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { stdout += chunk })
      child.stderr.on('data', (chunk: string) => { stderr += chunk })
      child.once('error', (error) => {
        if (settled) return
        settled = true
        reject(error)
      })
      child.once('close', (exitCode) => {
        if (settled) return
        settled = true
        resolve({ exitCode: exitCode ?? -1, stdout, stderr })
      })

      child.stdin.end(stdin)
    })
  }
}

