import '@xyflow/react/dist/style.css'
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import ChatOutlined from '@mui/icons-material/ChatOutlined'
import DataObjectRounded from '@mui/icons-material/DataObjectRounded'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import SaveOutlined from '@mui/icons-material/SaveOutlined'
import SettingsOutlined from '@mui/icons-material/SettingsOutlined'
import SmartToyOutlined from '@mui/icons-material/SmartToyOutlined'
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Popover,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
} from '@xyflow/react'
import { useSnackbar } from 'notistack'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import { Link, useBlocker, useParams, useSearchParams } from 'react-router'
import { usePermissions } from '../../../auth/usePermissions'
import { BotSettingsDialog } from '../../../components/chatbots/BotSettingsDialog'
import { ChatbotLinesDialog } from '../../../components/chatbots/ChatbotDialogs'
import { DeletableEdge } from '../../../components/chatbots/DeletableEdge'
import { FlowEditorContext } from '../../../components/chatbots/flow-editor-context'
import {
  defaultData,
  EDGE_DEFAULTS,
  fromGraph,
  NODE_COLORS,
  newId,
  outputsOf,
  PALETTE,
  toGraph,
  type EditorEdge,
  type EditorNode,
} from '../../../components/chatbots/flow-model'
import { FlowNodeCard } from '../../../components/chatbots/FlowNodeCard'
import { NodeEditor, type Member } from '../../../components/chatbots/NodeEditor'
import { NodeIcon } from '../../../components/chatbots/node-icons'
import { TestChat } from '../../../components/chatbots/TestChat'
import { VariablesDialog } from '../../../components/chatbots/VariablesDialog'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { useTags, useWorkspaceId } from '../../../components/contacts/useContacts'
import { useChatColors } from '../../../components/inbox/chat-colors'
import { useDocumentTitle } from '../../../hooks/useDocumentTitle'
import { useFillHeight } from '../../../hooks/useFillHeight'
import { es } from '../../../i18n/es'
import { channelKeys } from '../../../lib/api/channels'
import {
  chatbotKeys,
  chatbotsApi,
  type Chatbot,
  type ChatbotChanges,
  type FlowIssue,
  type NodeKind,
} from '../../../lib/api/chatbots'
import { ApiError, errorMessage } from '../../../lib/api/errors'
import { teamApi } from '../../../lib/api/team'

const t = es.chatbots.editor
const NODE_TYPES = Object.fromEntries(
  (['start', ...PALETTE] as NodeKind[]).map((kind) => [kind, FlowNodeCard]),
)
const EDGE_TYPES = { deletable: DeletableEdge }
const DRAG_TYPE = 'application/x-chatbot-node'

/** Automatización → Chatbots → Editar: the flow editor, as in wasapi. */
export function ChatbotEditorPage() {
  const { chatbotId = '' } = useParams()
  const workspaceId = useWorkspaceId()
  const chatbot = useQuery({
    queryKey: chatbotKeys.one(workspaceId, chatbotId),
    queryFn: ({ signal }) => chatbotsApi.get(workspaceId, chatbotId, signal),
    enabled: workspaceId !== '',
    // The editor owns the flow while it is open.
    refetchOnWindowFocus: false,
  })
  useDocumentTitle(chatbot.data?.name ?? es.chatbots.title)
  if (chatbot.error)
    return (
      <Alert
        severity="error"
        action={
          <Button component={Link} to="/automation/chatbots">
            {t.back}
          </Button>
        }
      >
        {errorMessage(chatbot.error)}
      </Alert>
    )
  if (!chatbot.data) return <LinearProgress />
  return (
    <ReactFlowProvider>
      <FlowEditor key={chatbot.data.id} workspaceId={workspaceId} chatbot={chatbot.data} />
    </ReactFlowProvider>
  )
}

function issuesOf(error: unknown): FlowIssue[] | null {
  if (!(error instanceof ApiError)) return null
  const issues = error.body?.details?.issues
  return Array.isArray(issues) ? (issues as FlowIssue[]) : null
}

function FlowEditor({ workspaceId, chatbot }: { workspaceId: string; chatbot: Chatbot }) {
  const client = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const { has } = usePermissions()
  const colors = useChatColors()
  const [params] = useSearchParams()
  const { ref: fillRef, height } = useFillHeight<HTMLDivElement>()
  const canvas = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()

  const initial = useMemo(() => fromGraph(chatbot.graph), [chatbot.graph])
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<EditorEdge>(initial.edges)
  const [current, setCurrent] = useState(chatbot)
  const [issues, setIssues] = useState<FlowIssue[]>(chatbot.issues)
  const [dirty, setDirty] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [testing, setTesting] = useState(params.get('probar') === '1')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [linesOpen, setLinesOpen] = useState(false)
  const [variablesOpen, setVariablesOpen] = useState(false)
  const [issuesAnchor, setIssuesAnchor] = useState<HTMLElement | null>(null)

  const tags = useTags()
  const members = useQuery({
    queryKey: ['team', workspaceId, 'members', { status: 'ACTIVE' }],
    queryFn: () => teamApi.members(workspaceId, { status: 'ACTIVE' }),
    enabled: has('members.read'),
  })
  const memberList: Member[] = (members.data?.items ?? []).map((member) => ({
    membershipId: member.id,
    name: member.displayName,
  }))

  // The canvas as last rendered, for handlers that must not re-create on each change.
  const latest = useRef({ nodes, edges })
  useLayoutEffect(() => {
    latest.current = { nodes, edges }
  }, [nodes, edges])
  const graph = useCallback(() => toGraph(latest.current.nodes, latest.current.edges), [])

  // ─── Changes on the canvas ───
  const handleNodesChange = useCallback(
    (changes: NodeChange<EditorNode>[]) => {
      onNodesChange(changes)
      if (
        changes.some(
          (change) => change.type === 'remove' || (change.type === 'position' && !change.dragging),
        )
      )
        setDirty(true)
      if (changes.some((change) => change.type === 'remove' && change.id === editing))
        setEditing(null)
    },
    [onNodesChange, editing],
  )
  const handleEdgesChange = useCallback(
    (changes: EdgeChange<EditorEdge>[]) => {
      onEdgesChange(changes)
      if (changes.some((change) => change.type === 'remove')) setDirty(true)
    },
    [onEdgesChange],
  )
  const onConnect = useCallback(
    (connection: Connection) => {
      const handle = connection.sourceHandle ?? 'next'
      // Each way out goes to one node: a new connection replaces the old one.
      setEdges((current) =>
        addEdge(
          { ...connection, ...EDGE_DEFAULTS, sourceHandle: handle, id: newId('e') },
          current.filter(
            (edge) =>
              !(edge.source === connection.source && (edge.sourceHandle ?? 'next') === handle),
          ),
        ),
      )
      setDirty(true)
    },
    [setEdges],
  )
  const isValidConnection: IsValidConnection<EditorEdge> = useCallback(
    (connection) =>
      connection.source !== connection.target &&
      latest.current.nodes.find((node) => node.id === connection.target)?.type !== 'start',
    [],
  )

  const addNode = (kind: NodeKind, position?: { x: number; y: number }) => {
    const box = canvas.current?.getBoundingClientRect()
    const at =
      position ??
      screenToFlowPosition({
        x: (box?.left ?? 0) + (box?.width ?? 600) / 2 - 130,
        y: (box?.top ?? 0) + (box?.height ?? 400) / 3,
      })
    const id = newId('n')
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id,
        type: kind,
        position: at,
        data: defaultData(kind) as Record<string, unknown>,
        selected: true,
      },
    ])
    setEditing(id)
    setDirty(true)
  }

  const updateData = (id: string, data: Record<string, unknown>) => {
    const node = latest.current.nodes.find((item) => item.id === id)
    if (!node) return
    const handles = new Set(outputsOf(node.type as NodeKind, data).map((output) => output.id))
    setNodes((current) => current.map((item) => (item.id === id ? { ...item, data } : item)))
    // Options that disappeared take their connections with them.
    setEdges((current) =>
      current.filter((edge) => edge.source !== id || handles.has(edge.sourceHandle ?? 'next')),
    )
    requestAnimationFrame(() => updateNodeInternals(id))
    setDirty(true)
  }

  const deleteNode = (id: string) => {
    setNodes((current) => current.filter((node) => node.id !== id))
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id))
    setEditing(null)
    setDirty(true)
  }

  // ─── Saving ───
  const save = useMutation({
    mutationFn: (changes: ChatbotChanges) =>
      chatbotsApi.update(workspaceId, chatbot.id, { graph: graph(), ...changes }),
    onSuccess: (saved, changes) => {
      setCurrent(saved)
      setIssues(saved.issues)
      setDirty(false)
      client.setQueryData(chatbotKeys.one(workspaceId, chatbot.id), saved)
      void client.invalidateQueries({ queryKey: chatbotKeys.all(workspaceId), exact: true })
      enqueueSnackbar(
        changes.enabled === true
          ? es.chatbots.enabledNow
          : changes.enabled === false
            ? es.chatbots.disabledNow
            : es.chatbots.saved,
        { variant: 'success' },
      )
    },
    onError: (error) => {
      const found = issuesOf(error)
      if (found) setIssues(found)
      enqueueSnackbar(errorMessage(error), { variant: 'error' })
    },
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!save.isPending) save.mutate({})
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  // Leaving with unsaved changes asks first (inside the app and on reload).
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  )
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const byNode = useMemo(() => {
    const map = new Map<string, FlowIssue[]>()
    for (const issue of issues) {
      if (!issue.nodeId) continue
      map.set(issue.nodeId, [...(map.get(issue.nodeId) ?? []), issue])
    }
    return map
  }, [issues])
  const errors = issues.filter((issue) => issue.level === 'error').length
  const warnings = issues.length - errors
  const context = useMemo(
    () => ({
      issues: byNode,
      tags: new Map((tags.data ?? []).map((tag) => [tag.id, tag])),
      onEdit: setEditing,
      variables: current.variables,
      contactVariables: current.contactVariables,
      onOpenVariables: () => setVariablesOpen(true),
    }),
    [byNode, tags.data, current.variables, current.contactVariables],
  )
  // Settings, lines and variables are saved apart from the flow on the canvas.
  const keepGraph = (saved: Chatbot) => {
    setCurrent((before) => ({ ...saved, graph: before.graph }))
    client.setQueryData<Chatbot>(chatbotKeys.one(workspaceId, chatbot.id), (before) =>
      before ? { ...saved, graph: before.graph } : saved,
    )
    void client.invalidateQueries({ queryKey: chatbotKeys.all(workspaceId), exact: true })
  }
  const editingNode = nodes.find((node) => node.id === editing) ?? null

  const focusNode = (id: string) => {
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === id })))
    void fitView({ nodes: [{ id }], duration: 300, maxZoom: 1.2 })
    setEditing(id)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    const kind = event.dataTransfer.getData(DRAG_TYPE) as NodeKind
    if (!kind) return
    addNode(kind, screenToFlowPosition({ x: event.clientX - 130, y: event.clientY - 20 }))
  }

  return (
    <FlowEditorContext.Provider value={context}>
      <Box
        ref={fillRef}
        sx={{
          height: height ?? 600,
          display: 'flex',
          flexDirection: 'column',
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'hidden',
          bgcolor: 'background.paper',
        }}
      >
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{
            alignItems: 'center',
            flexWrap: 'wrap',
            px: 1.5,
            py: 1,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Tooltip title={t.back}>
            <IconButton component={Link} to="/automation/chatbots" aria-label={t.back}>
              <ArrowBackRounded />
            </IconButton>
          </Tooltip>
          <SmartToyOutlined color="primary" />
          <Typography component="h1" variant="h6" noWrap sx={{ fontWeight: 700, minWidth: 0 }}>
            {current.name}
          </Typography>
          <FormControlLabel
            sx={{ ml: 1 }}
            control={
              <Switch
                checked={current.enabled}
                disabled={save.isPending}
                onChange={(event) => save.mutate({ enabled: event.target.checked })}
              />
            }
            label={t.enabled}
          />
          <Chip
            size="small"
            clickable={issues.length > 0}
            onClick={(event) => issues.length > 0 && setIssuesAnchor(event.currentTarget)}
            color={errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'success'}
            variant="outlined"
            icon={errors > 0 ? <ErrorOutlineRounded /> : undefined}
            label={t.issues(errors, warnings)}
          />
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" color={dirty ? 'warning.main' : 'text.secondary'}>
            {save.isPending ? t.saving : dirty ? t.unsaved : t.saved}
          </Typography>
          <Button
            size="small"
            startIcon={<ChatOutlined />}
            onClick={() => {
              setEditing(null)
              setTesting(true)
            }}
          >
            {t.test}
          </Button>
          <Button
            size="small"
            startIcon={<DataObjectRounded />}
            onClick={() => setVariablesOpen(true)}
          >
            {t.variables}
          </Button>
          <Button
            size="small"
            startIcon={<SettingsOutlined />}
            onClick={() => setSettingsOpen(true)}
          >
            {t.settings}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<SaveOutlined />}
            disabled={save.isPending || !dirty}
            onClick={() => save.mutate({})}
          >
            {t.save}
          </Button>
        </Stack>
        <Box sx={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
          <Box
            ref={canvas}
            sx={{ flex: 1, minWidth: 0 }}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }}
            onDrop={onDrop}
          >
            <ReactFlow<EditorNode, EditorEdge>
              aria-label={t.canvas}
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onNodeDoubleClick={(_, node) => setEditing(node.id)}
              deleteKeyCode={['Delete', 'Backspace']}
              selectionKeyCode="Shift"
              multiSelectionKeyCode={['Meta', 'Control']}
              colorMode={colors.dark ? 'dark' : 'light'}
              defaultEdgeOptions={EDGE_DEFAULTS}
              fitView
              fitViewOptions={{ maxZoom: 1 }}
              minZoom={0.2}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={18} />
              <Controls />
              <MiniMap pannable zoomable nodeColor={(node) => NODE_COLORS[node.type as NodeKind]} />
            </ReactFlow>
          </Box>
          <Box
            sx={{
              width: { xs: '100%', md: 360 },
              position: { xs: 'absolute', md: 'static' },
              inset: { xs: 0, md: 'auto' },
              zIndex: 5,
              display: {
                xs: editingNode || testing ? 'block' : 'none',
                md: 'block',
              },
              borderLeft: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              minHeight: 0,
            }}
          >
            {editingNode ? (
              <NodeEditor
                key={editingNode.id}
                workspaceId={workspaceId}
                chatbotId={chatbot.id}
                node={editingNode}
                tags={tags.data ?? []}
                members={memberList}
                onChange={(data) => updateData(editingNode.id, data)}
                onDelete={() => deleteNode(editingNode.id)}
                onClose={() => setEditing(null)}
              />
            ) : null}
            {/* Kept mounted so the test chat survives editing a node. */}
            <Box sx={{ height: '100%', display: !editingNode && testing ? 'block' : 'none' }}>
              {testing && (
                <TestChat
                  workspaceId={workspaceId}
                  graph={graph}
                  settings={current}
                  variables={current.variables}
                  tags={tags.data ?? []}
                  members={memberList}
                  onClose={() => setTesting(false)}
                />
              )}
            </Box>
            {!editingNode && !testing && <Palette onAdd={(kind) => addNode(kind)} />}
          </Box>
        </Box>
      </Box>

      <Popover
        open={!!issuesAnchor}
        anchorEl={issuesAnchor}
        onClose={() => setIssuesAnchor(null)}
        slotProps={{ paper: { sx: { width: 360, maxHeight: 420 } } }}
      >
        <Typography sx={{ px: 2, pt: 1.5, fontWeight: 700 }}>{t.issuesTitle}</Typography>
        <List dense>
          {issues.map((issue, index) => {
            const node = nodes.find((item) => item.id === issue.nodeId)
            return (
              <ListItemButton
                key={index}
                disabled={!node}
                onClick={() => {
                  setIssuesAnchor(null)
                  if (node) focusNode(node.id)
                }}
              >
                <ListItemIcon sx={{ minWidth: 34 }}>
                  <ErrorOutlineRounded color={issue.level === 'error' ? 'error' : 'warning'} />
                </ListItemIcon>
                <ListItemText
                  primary={issue.message}
                  secondary={node ? es.chatbots.nodes[node.type as NodeKind].label : undefined}
                />
              </ListItemButton>
            )
          })}
        </List>
      </Popover>

      {settingsOpen && (
        <BotSettingsDialog
          chatbot={current}
          onClose={() => setSettingsOpen(false)}
          onChangeLines={() => setLinesOpen(true)}
          onSubmit={async (changes) => {
            keepGraph(await chatbotsApi.update(workspaceId, chatbot.id, changes))
            enqueueSnackbar(es.chatbots.saved, { variant: 'success' })
          }}
        />
      )}
      {linesOpen && (
        <LinesDialog
          workspaceId={workspaceId}
          chatbot={current}
          onClose={() => setLinesOpen(false)}
          onSubmit={async (lineIds, takeOver) => {
            keepGraph(await chatbotsApi.setLines(workspaceId, chatbot.id, lineIds, takeOver))
            void client.invalidateQueries({ queryKey: channelKeys.lines(workspaceId) })
            enqueueSnackbar(es.chatbots.linesSaved, { variant: 'success' })
          }}
        />
      )}
      {variablesOpen && (
        <VariablesDialog
          variables={current.variables}
          contactVariables={current.contactVariables}
          onClose={() => setVariablesOpen(false)}
          onSave={async (variables) => {
            keepGraph(await chatbotsApi.update(workspaceId, chatbot.id, { variables }))
            enqueueSnackbar(es.chatbots.variables.saved, { variant: 'success' })
          }}
        />
      )}
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title={t.leaveTitle}
        confirmLabel={t.leave}
        danger
        onClose={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      >
        {t.leaveBody}
      </ConfirmDialog>
    </FlowEditorContext.Provider>
  )
}

/** "Asignar líneas" from the editor: it needs the other bots to warn about their lines. */
function LinesDialog({
  workspaceId,
  chatbot,
  onClose,
  onSubmit,
}: {
  workspaceId: string
  chatbot: Chatbot
  onClose: () => void
  onSubmit: (lineIds: string[], takeOver: boolean) => Promise<void>
}) {
  const bots = useQuery({
    queryKey: chatbotKeys.all(workspaceId),
    queryFn: ({ signal }) => chatbotsApi.list(workspaceId, signal),
  })
  if (!bots.data) return null
  return (
    <ChatbotLinesDialog
      workspaceId={workspaceId}
      chatbot={chatbot}
      chatbots={bots.data}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  )
}

/** "Opciones de respuesta": what can be added to the flow, as in wasapi. */
function Palette({ onAdd }: { onAdd: (kind: NodeKind) => void }) {
  return (
    <Stack sx={{ height: '100%' }} aria-label={t.palette}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography sx={{ fontWeight: 700 }}>{t.palette}</Typography>
        <Typography variant="caption" color="text.secondary">
          {t.paletteHelp}
        </Typography>
      </Box>
      <List dense sx={{ overflowY: 'auto', flex: 1, px: 1 }}>
        {PALETTE.map((kind) => (
          <ListItemButton
            key={kind}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(DRAG_TYPE, kind)
              event.dataTransfer.effectAllowed = 'move'
            }}
            onClick={() => onAdd(kind)}
            sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mb: 0.75 }}
          >
            <ListItemIcon sx={{ minWidth: 36 }}>
              <NodeIcon kind={kind} sx={{ color: NODE_COLORS[kind] }} />
            </ListItemIcon>
            <ListItemText
              primary={es.chatbots.nodes[kind].label}
              secondary={es.chatbots.nodes[kind].help}
            />
          </ListItemButton>
        ))}
      </List>
      <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 1 }}>
        {t.selectHelp}
      </Typography>
    </Stack>
  )
}
