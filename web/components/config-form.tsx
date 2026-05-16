'use client'

import * as React from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Trash2, Plus } from 'lucide-react'

import {
  ConfigSchema,
  defaults,
  LogLevels,
  LogRotations,
  EscalationChannels,
  type ConfigShape,
} from '@/lib/config-schema'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'

type Props = {
  initial: ConfigShape
  source: string
  path: string
}

function Field({
  label,
  unit,
  hint,
  children,
}: {
  label: string
  unit?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label className="flex items-baseline gap-2">
        <span>{label}</span>
        {unit && <span className="text-xs font-normal text-muted-foreground">({unit})</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function StringListEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = React.useState('')
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.length === 0 && (
          <span className="text-xs text-muted-foreground">(empty list)</span>
        )}
        {value.map((v, i) => (
          <Badge key={`${v}-${i}`} variant="secondary" className="gap-2 pr-1">
            <span className="font-mono text-xs">{v}</span>
            <button
              type="button"
              className="rounded p-0.5 hover:bg-background"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              aria-label={`Remove ${v}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const t = draft.trim()
              if (t && !value.includes(t)) onChange([...value, t])
              setDraft('')
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const t = draft.trim()
            if (t && !value.includes(t)) onChange([...value, t])
            setDraft('')
          }}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export function ConfigForm({ initial, source, path }: Props) {
  const { toast } = useToast()
  const [saving, setSaving] = React.useState(false)

  const form = useForm<ConfigShape>({
    resolver: zodResolver(ConfigSchema),
    defaultValues: initial,
  })

  const { register, handleSubmit, control, formState, reset } = form

  const onSubmit = async (data: ConfigShape) => {
    setSaving(true)
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        toast({
          variant: 'destructive',
          title: 'Save failed',
          description: typeof j.error === 'string' ? j.error : 'Unknown error',
        })
        return
      }
      reset(data)
      toast({ title: 'Saved', description: 'Bot will hot-reload from YAML.' })
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Network error',
      })
    } finally {
      setSaving(false)
    }
  }

  const onReset = () => {
    reset(defaults)
    toast({ title: 'Reset', description: 'Form reverted to bot defaults. Click Save to persist.' })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>Source:</span>
            <Badge variant="outline">{source}</Badge>
          </div>
          <p className="font-mono text-xs text-muted-foreground">{path}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onReset} disabled={saving}>
            Reset to defaults
          </Button>
          <Button type="submit" disabled={saving || !formState.isDirty}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="scheduler" className="w-full">
        <TabsList className="flex h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="scheduler">Scheduler</TabsTrigger>
          <TabsTrigger value="kb">KB</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="logging">Logging</TabsTrigger>
          <TabsTrigger value="escalation">Escalation</TabsTrigger>
          <TabsTrigger value="filter">Filter</TabsTrigger>
          <TabsTrigger value="manual">Manual jobs</TabsTrigger>
          <TabsTrigger value="boot">Boot</TabsTrigger>
        </TabsList>

        <TabsContent value="scheduler">
          <Card>
            <CardHeader>
              <CardTitle>Scheduler</CardTitle>
              <CardDescription>Timing of reply windows, debounce, jitter.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="debounceMs" unit="ms" hint="Quiet window after a message before considering the incoming burst closed and scheduling a reply.">
                <Input type="number" min={1} step={1} {...register('debounceMs', { valueAsNumber: true })} />
              </Field>
              <Field label="hardCapMs" unit="ms" hint="Absolute upper bound from the first message to scheduling, even if the burst hasn't quieted down.">
                <Input type="number" min={1} step={1} {...register('hardCapMs', { valueAsNumber: true })} />
              </Field>
              <Field label="minDelayMs" unit="ms" hint="Floor on the computed reply delay; replies never arrive faster than this.">
                <Input type="number" min={1} step={1} {...register('minDelayMs', { valueAsNumber: true })} />
              </Field>
              <Field label="maxDelayMs" unit="ms" hint="Ceiling on the computed reply delay; replies never arrive later than this.">
                <Input type="number" min={1} step={1} {...register('maxDelayMs', { valueAsNumber: true })} />
              </Field>
              <Field label="jitterPct" unit="0..1" hint="Random spread applied to the base delay so replies don't feel robotic. 0.2 = ±20%.">
                <Input type="number" min={0} max={1} step={0.01} {...register('jitterPct', { valueAsNumber: true })} />
              </Field>
              <Field label="fallbackDelayMs" unit="ms" hint="Used when no past latency exists for this chat (cold start).">
                <Input type="number" min={1} step={1} {...register('fallbackDelayMs', { valueAsNumber: true })} />
              </Field>
              <Field label="rollingLatencyWindow" unit="samples" hint="How many past reply-latency samples feed the rolling average that drives the next delay.">
                <Input type="number" min={1} step={1} {...register('rollingLatencyWindow', { valueAsNumber: true })} />
              </Field>
              <Field label="tickIntervalMs" unit="ms" hint="How often the scheduler scans chat_state to fire due replies.">
                <Input type="number" min={1} step={1} {...register('tickIntervalMs', { valueAsNumber: true })} />
              </Field>
              <Field label="manualJobsTickIntervalMs" unit="ms" hint="How often the manual-jobs cron checks for due date_anchored / revive / re_engage jobs.">
                <Input type="number" min={1} step={1} {...register('manualJobsTickIntervalMs', { valueAsNumber: true })} />
              </Field>
              <Field label="timezone" hint="IANA tz name (e.g. Europe/Rome). Drives night-window and scheduled-hour math.">
                <Input type="text" {...register('timezone')} />
              </Field>
              <Field label="sessionDir" hint="Restart required. Path where whatsapp-web.js stores the QR-paired session.">
                <Input type="text" {...register('sessionDir')} />
              </Field>
              <Field label="dbPath" hint="Restart required. SQLite file path for processed_messages, chat_state, facts, escalations.">
                <Input type="text" {...register('dbPath')} />
              </Field>
              <Separator className="md:col-span-2" />
              <Field label="nightWindow.startHour" unit="0..23" hint="Local hour when quiet hours start. Replies scheduled in the night are pushed to the morning.">
                <Input type="number" min={0} max={23} step={1} {...register('nightWindow.startHour', { valueAsNumber: true })} />
              </Field>
              <Field label="nightWindow.endHour" unit="0..23" hint="Local hour when quiet hours end (morning start).">
                <Input type="number" min={0} max={23} step={1} {...register('nightWindow.endHour', { valueAsNumber: true })} />
              </Field>
              <Field label="postReconnectSpreadMs.min" unit="ms" hint="After a reconnect, minimum stagger between the catch-up replies so they don't fire all at once.">
                <Input type="number" min={0} step={1} {...register('postReconnectSpreadMs.min', { valueAsNumber: true })} />
              </Field>
              <Field label="postReconnectSpreadMs.max" unit="ms" hint="After a reconnect, maximum stagger between the catch-up replies.">
                <Input type="number" min={1} step={1} {...register('postReconnectSpreadMs.max', { valueAsNumber: true })} />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="kb">
          <Card>
            <CardHeader>
              <CardTitle>Knowledge base</CardTitle>
              <CardDescription>RAG retrieval and ephemeral fact TTL.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="ephemeralTtlDays" unit="days" hint="TTL for ephemeral facts (plans, moods, short-term states) before the pruner deletes them.">
                <Input type="number" min={1} step={1} {...register('ephemeralTtlDays', { valueAsNumber: true })} />
              </Field>
              <Field label="ragTopK" unit="facts" hint="How many secondary facts the RAG retrieves and injects into each turn's context.">
                <Input type="number" min={1} step={1} {...register('ragTopK', { valueAsNumber: true })} />
              </Field>
              <Field label="embeddingModel" hint="Restart required. transformers.js model id used to embed facts (e.g. Xenova/bge-small-en-v1.5).">
                <Input type="text" {...register('embeddingModel')} />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai">
          <Card>
            <CardHeader>
              <CardTitle>AI</CardTitle>
              <CardDescription>Model selection and per-turn parameters.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="aiModel" hint="Restart required. opencode:<provider>/<model>[@variant]. E.g. opencode:github-copilot/gpt-5-mini.">
                <Input type="text" {...register('aiModel')} />
              </Field>
              <Field label="aiHistoryLimit" unit="messages" hint="How many recent chat messages get included in the per-turn prompt as conversation history.">
                <Input type="number" min={1} step={1} {...register('aiHistoryLimit', { valueAsNumber: true })} />
              </Field>
              <Field label="aiMaxRetryParseFail" unit="retries" hint="Max re-asks when the model returns invalid JSON. 0 = single shot, no retry.">
                <Input type="number" min={0} step={1} {...register('aiMaxRetryParseFail', { valueAsNumber: true })} />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logging">
          <Card>
            <CardHeader>
              <CardTitle>Logging</CardTitle>
              <CardDescription>Verbosity, output file, rotation.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="logLevel" hint="Verbosity. trace = firehose (extracted-fact bodies, full prompt/response sizes), debug = state transitions + AI call meta, info = lifecycle events only.">
                <Controller
                  control={control}
                  name="logLevel"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LogLevels.map((l) => (
                          <SelectItem key={l} value={l}>
                            {l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="logRotation" hint="Restart required. How often a new log file is rolled (daily / hourly).">
                <Controller
                  control={control}
                  name="logRotation"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LogRotations.map((l) => (
                          <SelectItem key={l} value={l}>
                            {l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="logFile" hint="Restart required. Path where pino writes structured log lines.">
                <Input type="text" {...register('logFile')} />
              </Field>
              <Field label="logMaxSize" hint='Roll the file early when it exceeds this size. Suffix k/m/g (e.g. "50m").'>
                <Input type="text" {...register('logMaxSize')} />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="escalation">
          <Card>
            <CardHeader>
              <CardTitle>Escalation</CardTitle>
              <CardDescription>Channels and rate limits for human handoff.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="enabled" hint="Master switch. When off, the bot replies autonomously even on uncertain turns (no human handoff).">
                <Controller
                  control={control}
                  name="escalation.enabled"
                  render={({ field }) => (
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
              </Field>
              <Field label="highUrgencyBypassRateLimit" hint="If on, escalations marked high-urgency by the AI ignore the per-hour rate cap.">
                <Controller
                  control={control}
                  name="escalation.highUrgencyBypassRateLimit"
                  render={({ field }) => (
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
              </Field>
              <Field label="channels" hint="Where to notify you. whatsapp_self = self-chat on your own WhatsApp number. telegram = bot DM via Telegram Bot API. Either or both.">
                <Controller
                  control={control}
                  name="escalation.channels"
                  render={({ field }) => (
                    <div className="space-y-2">
                      {EscalationChannels.map((c) => {
                        const checked = field.value.includes(c)
                        return (
                          <label key={c} className="flex items-center gap-3 text-sm">
                            <Switch
                              checked={checked}
                              onCheckedChange={(on) => {
                                if (on) field.onChange([...field.value, c])
                                else field.onChange(field.value.filter((x) => x !== c))
                              }}
                            />
                            <span className="font-mono">{c}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                />
              </Field>
              <div />
              <Field label="rateLimitPerHour" unit="msgs/hour" hint="Max escalations notified per hour. 0 = unlimited. Excess get aggregated rather than dropped.">
                <Input type="number" min={0} step={1} {...register('escalation.rateLimitPerHour', { valueAsNumber: true })} />
              </Field>
              <Field label="retryIntervalMs" unit="ms" hint="Backoff between attempts when notify fails (e.g. Telegram API down).">
                <Input type="number" min={1} step={1} {...register('escalation.retryIntervalMs', { valueAsNumber: true })} />
              </Field>
              <Field label="retryMaxAttempts" hint="Max retries for a failed notify before giving up. Counter is in-memory, resets on bot restart.">
                <Input type="number" min={0} step={1} {...register('escalation.retryMaxAttempts', { valueAsNumber: true })} />
              </Field>
              <div />
              <Field label="whatsappSelfChatId" hint='"me" resolves to your own WhatsApp number at runtime. Override with an explicit jid only if you need a different target.'>
                <Input type="text" {...register('escalation.whatsappSelfChatId')} />
              </Field>
              <div />
              <Field label="telegramBotTokenEnv" hint="Name of the env var holding the bot token (NOT the token itself). Default: TELEGRAM_BOT_TOKEN. Token lives in .env.">
                <Input type="text" {...register('escalation.telegramBotTokenEnv')} />
              </Field>
              <Field label="telegramChatIdEnv" hint="Name of the env var holding your Telegram chat id (NOT the id itself). Supports comma-separated for multi-recipient broadcast. Default: TELEGRAM_USER_CHAT_ID.">
                <Input type="text" {...register('escalation.telegramChatIdEnv')} />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="filter">
          <Card>
            <CardHeader>
              <CardTitle>Reply filter</CardTitle>
              <CardDescription>
                Declarative rules: which chats the bot will reply to. Block wins over allow.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              <Field
                label="Allowed prefixes"
                hint='Phone-number prefix whitelist in E.164 form (e.g. "+84" matches every Vietnamese number). Empty list = allow every prefix.'
              >
                <Controller
                  control={control}
                  name="filter.allowedPrefixes"
                  render={({ field }) => (
                    <StringListEditor
                      value={field.value ?? []}
                      onChange={field.onChange}
                      placeholder="+84"
                    />
                  )}
                />
              </Field>
              <Separator />
              <Field
                label="Blocked numbers"
                hint="Exact E.164 numbers to always deny, even if they match an allowed prefix. Block always wins over allow."
              >
                <Controller
                  control={control}
                  name="filter.blockedNumbers"
                  render={({ field }) => (
                    <StringListEditor
                      value={field.value ?? []}
                      onChange={field.onChange}
                      placeholder="+84111111111"
                    />
                  )}
                />
              </Field>
              <Separator />
              <Field label="Saved contacts only" hint="If on, reply only when the WhatsApp contact is in your address book. Useful to silence unknown numbers.">
                <Controller
                  control={control}
                  name="filter.savedContactsOnly"
                  render={({ field }) => (
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
              </Field>
              <Field label="Unread only" hint="If on, reply only when the chat has at least one unread message at the moment the event arrives. Edge-case filter, leave off normally.">
                <Controller
                  control={control}
                  name="filter.unreadOnly"
                  render={({ field }) => (
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual">
          <Card>
            <CardHeader>
              <CardTitle>Manual jobs / re-engage</CardTitle>
              <CardDescription>Cold-contact revival thresholds.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="reEngageDefaultThresholdDays" unit="days" hint="Default silence window after which a chat becomes a re-engage candidate (the bot offers to ping them).">
                <Input type="number" min={1} step={1} {...register('reEngageDefaultThresholdDays', { valueAsNumber: true })} />
              </Field>
              <Field label="reEngageColdAfterDays" unit="days" hint="If the re-engage attempt gets no reply within this window, the chat is marked cold and won't be re-engaged again automatically.">
                <Input type="number" min={1} step={1} {...register('reEngageColdAfterDays', { valueAsNumber: true })} />
              </Field>
              <Field label="reEngageMinOutgoingHistory" unit="messages" hint="Minimum number of past outgoing messages required before a chat is eligible for re-engage at all. Prevents pinging strangers.">
                <Input type="number" min={0} step={1} {...register('reEngageMinOutgoingHistory', { valueAsNumber: true })} />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="boot">
          <Card>
            <CardHeader>
              <CardTitle>Boot</CardTitle>
              <CardDescription>Startup-time chat fetch.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="bootMaxChatsToFetch" unit="chats" hint="On boot, max number of recent chats the reconciler will scan for missed messages. Caps boot time on accounts with many chats.">
                <Input type="number" min={1} step={1} {...register('bootMaxChatsToFetch', { valueAsNumber: true })} />
              </Field>
              <Field label="fetchConcurrency" unit="parallel" hint="How many chats the boot reconciler fetches in parallel. Higher = faster boot, but more pressure on WhatsApp Web.">
                <Input type="number" min={1} step={1} {...register('fetchConcurrency', { valueAsNumber: true })} />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {Object.keys(formState.errors).length > 0 && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          Form has validation errors. Open each tab to see field-level issues.
          <pre className="mt-2 text-xs">{JSON.stringify(formState.errors, null, 2)}</pre>
        </div>
      )}
    </form>
  )
}
