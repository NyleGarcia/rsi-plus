<script lang="ts">
  /**
   * Settings → Integrations → Issue Council: report templates (the *Insert template* menu on Report new issue),
   * *My setup*, and the game builds RSI+ has seen on Spectrum (what `{build}` fills in).
   */
  import { getSettings, patchSettings, scBuildsItem, settingsItem } from '@/lib/settings';
  import { DEFAULT_TEMPLATE } from '@/lib/issue-council';
  import { SC_ENVS, buildLabel, fillTemplate, type IcTemplate, type ScBuilds } from '@/lib/sc-builds';
  import { fmtDate } from '@/lib/dates';
  import { Input } from '@/components/ui/input';
  import { Textarea } from '@/components/ui/textarea';
  import { Label } from '@/components/ui/label';
  import { Button } from '@/components/ui/button';

  let templates = $state<IcTemplate[]>([]);
  let setup = $state('');
  let env = $state<(typeof SC_ENVS)[number]>('LIVE');
  let builds = $state<ScBuilds>({});
  $effect(() => {
    const load = async () => {
      const s = await getSettings();
      templates = s.icTemplates.map((t) => ({ ...t }));
      setup = s.icSetup;
      env = s.icEnv;
    };
    load();
    scBuildsItem.getValue().then((b) => (builds = b));
    const offs = [settingsItem.watch(load), scBuildsItem.watch((b) => (builds = b ?? {}))];
    return () => offs.forEach((o) => o());
  });
  const save = () => patchSettings({ icTemplates: $state.snapshot(templates) });
  const id = () => Math.random().toString(36).slice(2, 9);
  function add() {
    templates = [...templates, { id: id(), name: `Template ${templates.length + 1}`, body: DEFAULT_TEMPLATE }];
    save();
  }
  function remove(i: number) {
    templates = templates.filter((_, n) => n !== i);
    save();
  }
  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= templates.length) return;
    const next = [...templates];
    [next[i], next[j]] = [next[j]!, next[i]!];
    templates = next;
    save();
  }
  const preview = $derived(templates[0] ? fillTemplate(templates[0].body, { builds, env, setup, now: new Date() }) : '');
</script>

<div class="grid gap-3">
  <div class="grid gap-1.5">
    <Label for="ic-setup">My setup</Label>
    <Textarea id="ic-setup" rows={3} class="font-mono text-xs" placeholder="EU · Ryzen 7 7800X3D · RTX 4080 · 64 GB · Windows 11" value={setup} onchange={(e) => patchSettings({ icSetup: (e.currentTarget as HTMLTextAreaElement).value })} />
    <span class="text-muted-foreground text-xs">You type it; RSI+ never reads your hardware. <code>{'{setup}'}</code> in a template puts it there; the report bar also has <b>Insert my setup</b> for contributions.</span>
  </div>

  <div class="grid gap-1 text-xs">
    <span class="font-medium">Builds seen on Spectrum</span>
    {#each SC_ENVS as e (e)}
      {@const b = builds[e]}
      <span class="text-muted-foreground">{e}: {b ? `${buildLabel(b)} (seen ${fmtDate(b.at)})` : 'not seen yet: open the Patch Notes channel on Spectrum once'}</span>
    {/each}
    <span class="text-muted-foreground"><code>{'{build}'}</code> uses the environment picked in the report bar ({env} now); <code>{'{live}'}</code>, <code>{'{ptu}'}</code>, <code>{'{eptu}'}</code>, <code>{'{tech}'}</code> name one; <code>{'{date}'}</code> is today.</span>
  </div>

  <div class="grid gap-2">
    <span class="text-sm font-medium">Report templates</span>
    {#each templates as t, i (t.id)}
      <div class="grid gap-1.5 rounded-md border p-2">
        <div class="flex flex-wrap items-center gap-2">
          <Input class="h-7 w-48" aria-label="Template name" bind:value={t.name} onchange={save} />
          <Input class="h-7 w-48" aria-label="Issue Council category (optional)" placeholder="Category (optional)" bind:value={t.category} onchange={save} />
          <div class="ml-auto flex gap-1">
            <Button size="xs" variant="ghost" disabled={i === 0} aria-label="Move up" onclick={() => move(i, -1)}>↑</Button>
            <Button size="xs" variant="ghost" disabled={i === templates.length - 1} aria-label="Move down" onclick={() => move(i, 1)}>↓</Button>
            <Button size="xs" variant="ghost" disabled={templates.length === 1} onclick={() => remove(i)}>Delete</Button>
          </div>
        </div>
        <Textarea rows={7} class="font-mono text-xs" aria-label={`${t.name} text`} bind:value={t.body} onchange={save} />
      </div>
    {/each}
    <div class="flex items-center gap-2">
      <Button size="sm" variant="outline" onclick={add}>Add template</Button>
      <Button size="sm" variant="ghost" onclick={() => ((templates = [{ id: 'default', name: 'Default', body: DEFAULT_TEMPLATE }]), save())}>Reset to default</Button>
      <span class="text-muted-foreground text-xs">A template with a category is offered first once that category is picked on the form.</span>
    </div>
    {#if preview}
      <details class="text-xs">
        <summary class="text-muted-foreground cursor-pointer">Preview "{templates[0]?.name}" filled in</summary>
        <pre class="bg-muted mt-1 rounded p-2 whitespace-pre-wrap">{preview}</pre>
      </details>
    {/if}
  </div>
</div>
