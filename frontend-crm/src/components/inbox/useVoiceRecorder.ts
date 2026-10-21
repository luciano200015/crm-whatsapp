import { useEffect, useRef, useState } from 'react'
import { recordingType } from './outgoing-media'

type State = 'idle' | 'recording' | 'stopping'

/**
 * Voice notes with the browser's MediaRecorder, in a format WhatsApp
 * accepts (OGG/Opus or MP4/AAC). `supported` is false when the browser has
 * none of them.
 */
export function useVoiceRecorder() {
  const [type] = useState(recordingType)
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
    if (!type || state !== 'idle') return
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const media = new MediaRecorder(stream, { mimeType: type })
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

  /** Stops and returns the note as a file, or null if it was too short. */
  const stop = () =>
    new Promise<File | null>((resolve) => {
      const media = recorder.current
      if (!media || !type) {
        resolve(null)
        return
      }
      setState('stopping')
      media.onstop = () => {
        const base = type.split(';')[0] ?? 'audio/ogg'
        const blob = new Blob(chunks.current, { type: base })
        const extension = base === 'audio/ogg' ? 'ogg' : 'm4a'
        const file =
          blob.size > 0
            ? new File([blob], `nota-de-voz-${Date.now()}.${extension}`, { type: base })
            : null
        cleanup()
        resolve(file)
      }
      media.stop()
    })

  return {
    supported: type !== null,
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
