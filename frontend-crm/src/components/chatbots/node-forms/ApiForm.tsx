import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded'
import ErrorRounded from '@mui/icons-material/ErrorRounded'
import NetworkCheckRounded from '@mui/icons-material/NetworkCheckRounded'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { es } from '../../../i18n/es'
import {
  chatbotsApi,
  type ApiAuth,
  type HttpMethod,
  type NodeData,
} from '../../../lib/api/chatbots'
import { errorMessage } from '../../../lib/api/errors'
import { LIMITS, variablesIn } from '../flow-model'
import { Folding, PairList, TextWithTools } from './fields'

const t = es.chatbots.node
const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/**
 * «Consulta API», as in wasapi: the URL, the HTTP method, authentication
 * and three folding sections (headers, request and response parameters).
 */
export function ApiForm({
  workspaceId,
  data,
  onChange,
}: {
  workspaceId: string
  data: NodeData['api']
  onChange: (changes: Partial<NodeData['api']>) => void
}) {
  const [testing, setTesting] = useState(false)
  const setAuth = (changes: Partial<NodeData['api']['auth']>) =>
    onChange({ auth: { ...data.auth, ...changes } })
  const https = /^https:\/\/\S+\.\S+/.test(data.url)
  return (
    <>
      <TextWithTools
        label={t.apiUrl}
        value={data.url}
        max={LIMITS.apiUrl}
        required
        error={!https}
        helperText={t.apiUrlHelp}
        onValue={(url) => onChange({ url: url.replace(/\s/g, '') })}
      />
      <Stack direction="row" spacing={1}>
        <TextField
          select
          size="small"
          label={t.apiMethod}
          value={data.method}
          sx={{ minWidth: 120 }}
          onChange={(event) => onChange({ method: event.target.value as HttpMethod })}
        >
          {METHODS.map((method) => (
            <MenuItem key={method} value={method}>
              {method}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          fullWidth
          size="small"
          label={t.apiAuth}
          value={data.auth.type}
          onChange={(event) => setAuth({ type: event.target.value as ApiAuth })}
        >
          {(Object.keys(t.apiAuths) as ApiAuth[]).map((key) => (
            <MenuItem key={key} value={key}>
              {t.apiAuths[key]}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      {data.auth.type === 'bearer' && (
        <TextField
          size="small"
          label={t.apiToken}
          value={data.auth.token}
          helperText={t.apiSecretsHelp}
          onChange={(event) => setAuth({ token: event.target.value.slice(0, LIMITS.apiValue) })}
        />
      )}
      {data.auth.type === 'basic' && (
        <Stack spacing={1}>
          <TextField
            size="small"
            label={t.apiUser}
            value={data.auth.user}
            onChange={(event) => setAuth({ user: event.target.value.slice(0, LIMITS.apiValue) })}
          />
          <TextField
            size="small"
            type="password"
            label={t.apiPassword}
            value={data.auth.password}
            helperText={t.apiSecretsHelp}
            autoComplete="new-password"
            onChange={(event) =>
              setAuth({ password: event.target.value.slice(0, LIMITS.apiValue) })
            }
          />
        </Stack>
      )}
      <Folding title={t.apiHeaders} count={data.headers.length}>
        <PairList
          rows={data.headers}
          first={{ key: 'key', label: t.apiKey, max: LIMITS.apiKey }}
          second={{ key: 'value', label: t.apiValue, max: LIMITS.apiValue }}
          max={LIMITS.apiHeaders}
          addLabel={t.apiAdd}
          onChange={(headers) => onChange({ headers })}
        />
      </Folding>
      <Folding title={t.apiParams} count={data.params.length}>
        <Typography variant="caption" color="text.secondary">
          {t.apiParamsHelp}
        </Typography>
        <PairList
          rows={data.params}
          first={{ key: 'key', label: t.apiKey, max: LIMITS.apiKey }}
          second={{ key: 'value', label: t.apiValue, max: LIMITS.apiValue }}
          max={LIMITS.apiParams}
          addLabel={t.apiAdd}
          onChange={(params) => onChange({ params })}
        />
      </Folding>
      <Folding title={t.apiResponses} count={data.responses.length}>
        <Typography variant="caption" color="text.secondary">
          {t.apiResponsesHelp}
        </Typography>
        <PairList
          rows={data.responses}
          first={{ key: 'path', label: t.apiPath, max: LIMITS.apiPath }}
          second={{ key: 'variable', label: t.variable, max: 40 }}
          max={LIMITS.apiResponses}
          addLabel={t.apiAdd}
          onChange={(responses) => onChange({ responses })}
        />
      </Folding>
      <Box>
        <Button
          variant="outlined"
          color="success"
          startIcon={<NetworkCheckRounded />}
          disabled={!https}
          onClick={() => setTesting(true)}
        >
          {t.apiTest}
        </Button>
      </Box>
      {testing && (
        <ApiTestDialog workspaceId={workspaceId} api={data} onClose={() => setTesting(false)} />
      )}
    </>
  )
}

/** «Probar conexión»: test values for the variables, then the answer and what would be saved. */
function ApiTestDialog({
  workspaceId,
  api,
  onClose,
}: {
  workspaceId: string
  api: NodeData['api']
  onClose: () => void
}) {
  const names = variablesIn(
    api.url,
    api.auth.token,
    api.auth.user,
    api.auth.password,
    ...api.headers.map((header) => header.value),
    ...api.params.map((param) => param.value),
  )
  const [sample, setSample] = useState<Record<string, string>>({})
  const run = useMutation({
    mutationFn: () => chatbotsApi.testRequest(workspaceId, api, sample),
  })
  const result = run.data
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose} aria-labelledby="api-test-title">
      <DialogTitle id="api-test-title">{t.apiTest}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {t.apiCall(api.method, api.url)}
          </Typography>
          {names.length > 0 && (
            <Stack spacing={1}>
              <Typography variant="caption" color="text.secondary">
                {t.apiTestHelp}
              </Typography>
              {names.map((name) => (
                <TextField
                  key={name}
                  size="small"
                  label={`{{${name}}}`}
                  value={sample[name] ?? ''}
                  onChange={(event) =>
                    setSample((before) => ({ ...before, [name]: event.target.value.slice(0, 500) }))
                  }
                />
              ))}
            </Stack>
          )}
          {run.error && <Alert severity="error">{errorMessage(run.error)}</Alert>}
          {result && (
            <Stack spacing={1.5}>
              <Alert
                severity={result.ok ? 'success' : 'error'}
                icon={result.ok ? <CheckCircleRounded /> : <ErrorRounded />}
              >
                {[result.status ? t.apiTestStatus(result.status) : '', result.error ?? '']
                  .filter(Boolean)
                  .join(' · ') || t.ok}
              </Alert>
              {result.values.length > 0 && (
                <Box>
                  <Typography variant="subtitle2">{t.apiTestValues}</Typography>
                  {result.values.map((value) => (
                    <Typography key={value.variable} variant="body2">
                      {`{{${value.variable}}}`} = {value.value || t.apiTestEmptyValue}
                    </Typography>
                  ))}
                </Box>
              )}
              {result.body && (
                <Box>
                  <Typography variant="subtitle2">{t.apiTestBody}</Typography>
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      p: 1.5,
                      maxHeight: 240,
                      overflow: 'auto',
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {result.body}
                  </Box>
                </Box>
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{es.chatbots.editor.close}</Button>
        <Button
          variant="contained"
          color="success"
          disabled={run.isPending}
          onClick={() => run.mutate()}
        >
          {t.apiTestRun}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
