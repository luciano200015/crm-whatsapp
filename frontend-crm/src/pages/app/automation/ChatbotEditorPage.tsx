import '@xyflow/react/dist/style.css'
import AddRounded from '@mui/icons-material/AddRounded'
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import ChatOutlined from '@mui/icons-material/ChatOutlined'
import DataObjectRounded from '@mui/icons-material/DataObjectRounded'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import FullscreenExitRounded from '@mui/icons-material/FullscreenExitRounded'
import FullscreenRounded from '@mui/icons-material/FullscreenRounded'
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
  ListSubheader,
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
  lockedTargets,
  NODE_COLORS,
  NODE_KINDS,
  newId,
  outputsOf,
  PALETTE,
  toGraph,
  userMessages,
  waitsForAnswer,
  type EditorEdge,
  type EditorNode,
} from '../../../components/chatbots/flow-model'
import { FlowNodeCard } from '../../../components/chatbots/FlowNodeCard'
import { NodeEditor, type Member } from '../../../components/chatbots/NodeEditor'
import { NodeIcon } from '../../../components/chatbots/node-icons'
import { TestChat } from '../../../components/chatbots/TestChat'
import { VariablesDialog } from '../../../components/chatbots/VariablesDialog'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { useContactFields, useTags, useWorkspaceId } from '../../../components/contacts/useContacts'
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
const NODE_TYPES = Object.fromEntries(NODE_KINDS.map((kind) => [kind, FlowNodeCard]))
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
  // The side panel has changes not applied yet: opening another card asks first.
  const [draftDirty, setDraftDirty] = useState(false)
  const [pendingEdit, setPendingEdit] = useState<{ id: string | null } | null>(null)
  const openEditor = useCallback(
    (id: string | null) => {
      if (id === editing) return
      if (draftDirty) setPendingEdit({ id })
      else setEditing(id)
    },
    [editing, draftDirty],
  )
  const [testing, setTesting] = useState(params.get('probar') === '1')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [linesOpen, setLinesOpen] = useState(false)
  const [variablesOpen, setVariablesOpen] = useState(false)
  const [issuesAnchor, setIssuesAnchor] = useState<HTMLElement | null>(null)
  const [paletteAnchor, setPaletteAnchor] = useState<HTMLElement | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const frame = useRef<HTMLDivElement | null>(null)
  const [frameElement, setFrameElement] = useState<HTMLDivElement | null>(null)

  const tags = useTags()
  const fields = useContactFields(workspaceId, has('contacts.read'))
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
      const source = latest.current.nodes.find((node) => node.id === connection.source)
      // Each way out goes to one node: a new connection replaces the old one.
      // A message that waits opens several cards, one per answer.
      const many = waitsForAnswer(source?.type, source?.data ?? {})
      setEdges((current) =>
        addEdge(
          { ...connection, ...EDGE_DEFAULTS, sourceHandle: handle, id: newId('e') },
          many
            ? current
            : current.filter(
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
    openEditor(id)
    setDirty(true)
  }

  const updateData = (id: string, data: Record<string, unknown>) => {
    const node = latest.current.nodes.find((item) => item.id === id)
    if (!node) return
    const handles = new Set(outputsOf(node.type as NodeKind, data).map((output) => output.id))
    const many = waitsForAnswer(node.type, data)
    setNodes((current) => current.map((item) => (item.id === id ? { ...item, data } : item)))
    // Options that disappeared take their connections with them; a message
    // that stops waiting keeps only its first connection.
    const used = new Set<string>()
    setEdges((current) =>
      current.filter((edge) => {
        if (edge.source !== id) return true
        const handle = edge.sourceHandle ?? 'next'
        if (!handles.has(handle) || (!many && used.has(handle))) return false
        used.add(handle)
        return true
      }),
    )
    requestAnimationFrame(() => updateNodeInternals(id))
    setDirty(true)
  }

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((current) => current.filter((node) => node.id !== id))
      setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id))
      setEditing((current) => (current === id ? null : current))
      setDirty(true)
    },
    [setNodes, setEdges],
  )

  /** A copy beside it, without connections; options and rules get new ids. */
  const duplicateNode = useCallback(
    (id: string) => {
      const node = latest.current.nodes.find((item) => item.id === id)
      if (!node || node.type === 'start') return
      const copy = structuredClone(node.data)
      if (Array.isArray(copy.options))
        copy.options = (copy.options as { id: string }[]).map((option) => ({
          ...option,
          id: newId('o'),
        }))
      if (Array.isArray(copy.rules))
        copy.rules = (copy.rules as { id: string }[]).map((rule) => ({ ...rule, id: newId('c') }))
      const copyId = newId('n')
      setNodes((current) => [
        ...current.map((item) => ({ ...item, selected: false })),
        {
          id: copyId,
          type: node.type,
          position: { x: node.position.x + 40, y: node.position.y + 40 },
          data: copy,
          selected: true,
        },
      ])
      openEditor(copyId)
      setDirty(true)
    },
    [setNodes, openEditor],
  )

  // Fullscreen of the editor itself, so the panel and dialogs stay usable.
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === frame.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.()
    else void frame.current?.requestFullscreen?.()
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
  const openers = useMemo(() => userMessages(nodes, edges), [nodes, edges])
  const context = useMemo(
    () => ({
      issues: byNode,
      tags: new Map((tags.data ?? []).map((tag) => [tag.id, tag])),
      userMessages: openers,
      onEdit: openEditor,
      onDuplicate: duplicateNode,
      onDelete: deleteNode,
      variables: current.variables,
      contactVariables: current.contactVariables,
      contactFields: fields.data ?? [],
      onOpenVariables: () => setVariablesOpen(true),
      lineIds: current.lines.map((line) => line.id),
    }),
    [
      byNode,
      tags.data,
      openers,
      openEditor,
      duplicateNode,
      deleteNode,
      current.variables,
      current.contactVariables,
      fields.data,
      current.lines,
    ],
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
    openEditor(id)
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
        ref={(element: HTMLDivElement | null) => {
          fillRef.current = element
          frame.current = element
          setFrameElement(element)
        }}
        sx={{
          height: fullscreen ? '100vh' : (height ?? 600),
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
            sx={{
              ml: 1,
              pr: 1.25,
              borderRadius: 999,
              bgcolor: current.enabled ? 'rgba(34, 197, 94, 0.14)' : 'action.hover',
              '& .MuiFormControlLabel-label': {
                fontWeight: 700,
                fontSize: 14,
                color: current.enabled ? 'success.dark' : 'text.secondary',
              },
            }}
            control={
              <Switch
                size="small"
                color="success"
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
            {save.isPending ? t.saving : draftDirty ? t.notApplied : dirty ? t.unsaved : t.saved}
          </Typography>
          <Button
            size="small"
            variant="contained"
            color="info"
            disableElevation
            startIcon={<ChatOutlined />}
            onClick={() => {
              openEditor(null)
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
          <Tooltip title={fullscreen ? t.exitFullscreen : t.fullscreen}>
            <IconButton
              size="small"
              aria-label={fullscreen ? t.exitFullscreen : t.fullscreen}
              onClick={toggleFullscreen}
            >
              {fullscreen ? <FullscreenExitRounded /> : <FullscreenRounded />}
            </IconButton>
          </Tooltip>
          <Button
            size="small"
            variant="contained"
            color="success"
            disableElevation
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
            sx={{ flex: 1, minWidth: 0, position: 'relative' }}
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
              onNodeDoubleClick={(_, node) => openEditor(node.id)}
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
            <Button
              variant="contained"
              color="success"
              startIcon={<AddRounded />}
              aria-haspopup="dialog"
              onClick={(event) => setPaletteAnchor(event.currentTarget)}
              sx={{ position: 'absolute', top: 12, right: 12, zIndex: 5, borderRadius: 999 }}
            >
              {t.addNode}
            </Button>
          </Box>
          <Box
            sx={{
              width: { xs: '100%', md: 380 },
              position: { xs: 'absolute', md: 'static' },
              inset: { xs: 0, md: 'auto' },
              zIndex: 6,
              display: editingNode || testing ? 'block' : 'none',
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
                triggerLocked={lockedTargets(nodes, edges).has(editingNode.id)}
                tags={tags.data ?? []}
                members={memberList}
                onApply={(data) => updateData(editingNode.id, data)}
                onDelete={() => deleteNode(editingNode.id)}
                onClose={() => setEditing(null)}
                onDirtyChange={setDraftDirty}
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
                  fields={fields.data ?? []}
                  onClose={() => setTesting(false)}
                />
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      <Popover
        open={!!paletteAnchor}
        anchorEl={paletteAnchor}
        onClose={() => setPaletteAnchor(null)}
        container={frameElement}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 320, maxHeight: 520 } } }}
      >
        <Palette
          onAdd={(kind) => {
            setPaletteAnchor(null)
            addNode(kind)
          }}
          onDragStart={() => setPaletteAnchor(null)}
        />
      </Popover>
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
        open={!!pendingEdit}
        title={es.chatbots.editor.discardTitle}
        confirmLabel={es.chatbots.editor.discard}
        danger
        onClose={() => setPendingEdit(null)}
        onConfirm={() => {
          setEditing(pendingEdit?.id ?? null)
          setPendingEdit(null)
        }}
      >
        {es.chatbots.editor.discardBody}
      </ConfirmDialog>
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

/** «Agregar nodo»: the widgets by group, as in wasapi. Click, or drag to the canvas. */
function Palette({
  onAdd,
  onDragStart,
}: {
  onAdd: (kind: NodeKind) => void
  onDragStart: () => void
}) {
  return (
    <Box role="dialog" aria-label={t.palette}>
      <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
        <Typography sx={{ fontWeight: 700 }}>{t.palette}</Typography>
        <Typography variant="caption" color="text.secondary">
          {t.paletteHelp}
        </Typography>
      </Box>
      <List dense sx={{ px: 1, pt: 0 }}>
        {PALETTE.map(({ group, kinds }) => (
          <Box key={group}>
            <ListSubheader sx={{ lineHeight: '32px', fontWeight: 700 }}>
              {t.groups[group]}
            </ListSubheader>
            {kinds.map((kind) => (
              <ListItemButton
                key={kind}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(DRAG_TYPE, kind)
                  event.dataTransfer.effectAllowed = 'move'
                  onDragStart()
                }}
                onClick={() => onAdd(kind)}
                sx={{ borderRadius: 1 }}
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
          </Box>
        ))}
      </List>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ px: 2, pb: 1.5 }}>
        {t.selectHelp}
      </Typography>
    </Box>
  )
}
