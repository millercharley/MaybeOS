/**
 * Channels under the headings they file under (CMN-11).
 *
 * One function for both sidebars. The admin Commons page used to list
 * channels flat and ignore sections, so filing a channel under a heading
 * changed nothing an admin could see.
 *
 * Channels with no section come first, then each section in its own order.
 * A channel whose section id matches no section, for example one deleted a
 * moment ago in another tab, falls back to the ungrouped list instead of
 * disappearing. Within a group, pinned channels come first; otherwise the
 * order is the order given, which is the API's position order.
 */

export interface ChannelGroup<C, S> {
  /** Null for the channels that are in no section. */
  section: S | null;
  channels: C[];
}

export function groupChannels<
  C extends { sectionId?: string | null; isPinned?: boolean },
  S extends { id: string },
>(channels: C[], sections: S[], { includeEmpty = false }: { includeEmpty?: boolean } = {}): ChannelGroup<C, S>[] {
  const known = new Set(sections.map((s) => s.id));
  // Array.prototype.sort is stable, so equal pins keep their incoming order.
  const byPin = (a: C, b: C) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));

  const ungrouped = channels.filter((c) => !c.sectionId || !known.has(c.sectionId)).sort(byPin);

  const groups: ChannelGroup<C, S>[] = [];
  if (ungrouped.length > 0 || includeEmpty) groups.push({ section: null, channels: ungrouped });

  for (const section of sections) {
    const inside = channels.filter((c) => c.sectionId === section.id).sort(byPin);
    if (inside.length > 0 || includeEmpty) groups.push({ section, channels: inside });
  }

  return groups;
}
