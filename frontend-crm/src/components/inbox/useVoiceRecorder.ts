import { useEffect, useRef, useState } from 'react'
import { toOggOpus } from './ogg-opus'
import { recordingPlan } from './outgoing-media'

type State = 'idle' | 'recording' | 'stopping'

/**
 * Voice notes with the browser's MediaRecorder, always delivered as
 * OGG/Opus (what WhatsApp accepts as a voice message). `supported` is false
 * when the browser can neither record nor convert to that format.
 */
export function useVoiceRecorder() {
  const [plan] = useState(recordingPlan)
  const [state, setState] = useState<State>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const cleanup = () => {
    clearInterval(timer.current)
    recorder.current?.stream.getTracks().forEach((track) => track.stop())
    recorder.current = null
    chunks.current = []
    setSeconds(0)
    setState('idle')
  }
  useEffect(() => cleanup, [])

  const start = async () => {
    if (!plan || state !== 'idle') return
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const media = new MediaRecorder(stream, plan.mimeType ? { mimeType: plan.mimeType } : {})
      chunks.current = []
      media.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data)
      }
      media.start(250)
      recorder.current = media
      setState('recording')
      timer.current = setInterval(() => setSeconds((value) => value + 1), 1000)
    } catch {
      setError('No se pudo usar el micrófono. Revisa los permisos del navegador.')
      cleanup()
    }
  }

  /** Stops and returns the note as an OGG/Opus file, or null if nothing was recorded. */
  const stop = () =>
    new Promise<File | null>((resolve) => {
      const media = recorder.current
      if (!media || !plan) {
        resolve(null)
        return
      }
      setState('stopping')
      media.onstop = () => {
        const recording = new Blob(chunks.current, { type: media.mimeType })
        cleanup()
        if (recording.size === 0) {
          resolve(null)
          return
        }
        const name = `nota-de-voz-${Date.now()}.ogg`
        if (!plan.convert) {
          resolve(new File([recording], name, { type: 'audio/ogg' }))
          return
        }
        toOggOpus(recording)
          .then((ogg) => resolve(new File([ogg], name, { type: 'audio/ogg' })))
          .catch(() => {
            setError('No se pudo preparar la nota de voz en este navegador.')
            resolve(null)
          })
      }
      media.stop()
    })

  return {
    supported: plan !== null,
    recording: state !== 'idle',
    seconds,
    error,
    start,
    stop,
    cancel: () => {
      if (recorder.current) recorder.current.onstop = null
      recorder.current?.stop()
      cleanup()
    },
  }
}
