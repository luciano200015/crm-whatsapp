import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Grid from '@mui/material/Grid'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useMe } from '../../auth/useMe'
import { EmailVerificationBanner } from '../../components/EmailVerificationBanner'
import { PageHeader } from '../../components/PageHeader'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { es } from '../../i18n/es'
import { useActiveWorkspace } from '../../workspace/active-workspace-context'

export function DashboardPage() {
  useDocumentTitle(es.dashboard.title)
  const { data: me, isPending } = useMe()
  const { active, select } = useActiveWorkspace()

  if (isPending || !me) {
    return <Skeleton variant="rounded" height={240} />
  }

  return (
    <>
      <PageHeader title={es.dashboard.hello(me.displayName)} subtitle={es.dashboard.subtitle} />
      <EmailVerificationBanner />

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <Box sx={(theme) => ({ height: 4, background: theme.custom.gradient })} />
            <CardContent>
              <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                {es.dashboard.activeWorkspace}
              </Typography>
              {active ? (
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {active.name}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      /{active.slug}
                    </Typography>
                  </Box>
                  <ChipGroup label={es.dashboard.roles} items={active.roles} color="primary" />
                  <ChipGroup label={es.dashboard.permissions} items={active.permissions} />
                </Stack>
              ) : (
                <Typography sx={{ color: 'text.secondary' }}>{es.dashboard.noWorkspace}</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                {es.dashboard.allWorkspaces}
              </Typography>
              <Stack spacing={1} sx={{ mt: 1 }}>
                {me.workspaces.map((workspace) => {
                  const usable =
                    workspace.membershipStatus === 'ACTIVE' && workspace.status === 'ACTIVE'
                  const selected = active?.id === workspace.id
                  return (
                    <Box
                      key={workspace.id}
                      component={usable ? 'button' : 'div'}
                      type={usable ? 'button' : undefined}
                      onClick={usable ? () => select(workspace.id) : undefined}
                      sx={{
                        all: 'unset',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        p: 1.5,
                        borderRadius: 2,
                        border: 1,
                        borderColor: selected ? 'primary.main' : 'divider',
                        cursor: usable ? 'pointer' : 'default',
                        opacity: usable ? 1 : 0.55,
                        '&:hover': usable ? { bgcolor: 'action.hover' } : undefined,
                        '&:focus-visible': { outline: 2, outlineColor: 'primary.main' },
                      }}
                    >
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography noWrap sx={{ fontWeight: 600 }}>
                          {workspace.name}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {workspace.roles.join(', ')}
                        </Typography>
                      </Box>
                      {!usable && <Chip size="small" label={es.dashboard.deactivated} />}
                    </Box>
                  )
                })}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  )
}

function ChipGroup({ label, items, color }: { label: string; items: string[]; color?: 'primary' }) {
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
        {label}
      </Typography>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
        {items.map((item) => (
          <Chip
            key={item}
            label={item}
            size="small"
            color={color}
            variant={color ? 'filled' : 'outlined'}
          />
        ))}
      </Stack>
    </Box>
  )
}
