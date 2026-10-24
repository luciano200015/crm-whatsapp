import DataObjectRounded from '@mui/icons-material/DataObjectRounded'
import { Button, ListSubheader, Menu, MenuItem, Typography } from '@mui/material'
import { useState } from 'react'
import { es } from '../../i18n/es'
import { useFlowEditor } from './flow-editor-context'

const t = es.chatbots.variables

/**
 * "Agregar variable": the contact's data and the bot's variables. The
 * chosen one is added to the text as {{name}}.
 */
export function VariableButton({ onInsert }: { onInsert: (token: string) => void }) {
  const { variables, contactVariables } = useFlowEditor()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const pick = (name: string) => {
    setAnchor(null)
    onInsert(`{{${name}}}`)
  }
  return (
    <>
      <Button
        size="small"
        color="success"
        variant="contained"
        startIcon={<DataObjectRounded />}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ alignSelf: 'flex-start' }}
      >
        {t.insert}
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <ListSubheader>{t.contact}</ListSubheader>
        {contactVariables.map((name) => (
          <MenuItem key={name} onClick={() => pick(name)}>
            {t.contactLabels[name] ?? name}
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {`{{${name}}}`}
            </Typography>
          </MenuItem>
        ))}
        <ListSubheader>{t.mine}</ListSubheader>
        {variables.length === 0 && (
          <MenuItem disabled>
            <Typography variant="body2">{t.empty}</Typography>
          </MenuItem>
        )}
        {variables.map((variable) => (
          <MenuItem key={variable.name} onClick={() => pick(variable.name)}>
            {variable.name}
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {t.types[variable.type]}
            </Typography>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
