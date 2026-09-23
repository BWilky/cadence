// Mirrors cadence/backend/cadence/models.py

export type SkyState = "sunny" | "cloudy" | "dark";
export type StartKind = "clock" | "sun" | "motion" | "asleep" | "sensor";

export interface HAAction {
  domain: string;
  service: string;
  target?: Record<string, unknown> | null;
  data?: Record<string, unknown> | null;
  label?: string;
}

export interface SceneLink {
  entity_id: string;
  led_entity?: string | null;
  transition?: number | null;
}

export type MusicKind =
  | "spotify_context"
  | "volume_fade"
  | "volume_set"
  | "mute"
  | "unmute"
  | "source"
  | "play_playlist"
  | "play"
  | "pause"
  | "stop"
  | "service";

export interface MusicAction {
  kind: MusicKind;
  entity_id: string;
  volume?: number | null;
  from_volume?: number | null;
  from_zero?: boolean;
  minutes?: number | null;
  label?: string | null;
  image?: string | null;
  device?: string | null;
  source?: string | null;
  media_content_id?: string | null;
  media_content_type?: string | null;
  shuffle?: boolean | null;
  enqueue?: string | null;
  service?: string | null;
  data?: Record<string, unknown> | null;
  delay_seconds?: number;
}

export interface CadenceScene {
  id: string;
  name: string;
  description: string;
  color?: string | null;
  ha_scenes: SceneLink[];
  music: MusicAction[];
  extra_actions: HAAction[];
  zone_levels: Record<string, number>;
}

export interface VariantCondition {
  sky?: SkyState[] | null;
  light?: "light" | "dark" | null;
  motion?: boolean | null;
  asleep?: boolean | null;
  occupied?: boolean | null;
}

export interface Variant {
  key: string;
  label: string;
  when: VariantCondition;
  scene_ids: string[];
  note: string;
}

export interface ChapterStart {
  kind: StartKind;
  time?: string | null;
  entity_id?: string | null;
  to_state?: "on" | "off";
  sun_event?: "elevation" | "sunrise" | "sunset" | "dawn" | "dusk" | null;
  elevation?: number | null;
  direction: "rising" | "setting";
  offset_minutes: number;
  earliest?: string | null;
  latest?: string | null;
}

export interface ChapterHold {
  entity_id: string; // entity id or "group:<id>"
  while_state: "on" | "off";
  latest?: string | null;
  label?: string | null; // filled by the backend on resolved chapters
}

export interface Chapter {
  id: string;
  name: string;
  note: string;
  color?: string | null;
  enabled: boolean;
  start: ChapterStart;
  hold?: ChapterHold | null;
  fade_minutes: number;
  variants: Variant[];
  motion_entity?: string | null;
  motion_hold_minutes: number;
  reevaluate: boolean;
  music_only_on_entry: boolean;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  chapters: Chapter[];
}

export interface TimeWindow {
  start: string;
  end: string;
}

export interface ChapterOverride {
  chapter_id: string;
  start?: ChapterStart | null;
  variant_key?: string | null;
  enabled?: boolean | null;
}

export interface DayPlan {
  date: string;
  template_id?: string | null;
  chapter_overrides: ChapterOverride[];
  extra_chapters: Chapter[];
  auto: "default" | "on" | "off" | "windows";
  auto_windows: TimeWindow[];
  occupied?: boolean | null;
  notes: string;
}

export interface SkyConfig {
  lux_entity?: string | null;
  weather_entity?: string | null;
  dark_elevation: number;
  dark_lux: number;
  sunny_lux: number;
  hysteresis_pct: number;
  min_dwell_minutes: number;
  stale_minutes: number;
}

export interface SensorGroup {
  id: string;
  name: string;
  entities: string[];
  mode: "any" | "all";
  description: string;
}

export interface ZoneGlow {
  id: string;
  name: string;
  entity_id?: string | null;
}

export interface Settings {
  default_template_id?: string | null;
  auto_source: "either" | "schedule" | "entity" | "always";
  auto_schedule: { windows: Record<string, TimeWindow[]> };
  auto_entity?: string | null;
  motion_entity?: string | null;
  asleep_entity?: string | null;
  occupied_entity?: string | null;
  sky: SkyConfig;
  calendars: string[];
  calendar_keywords: string[];
  sensor_groups: SensorGroup[];
  spotify_entity?: string | null;
  zones: ZoneGlow[];
  site_name: string;
  dry_run: boolean;
  override_grace_seconds: number;
  hold_mode: "next_chapter" | "timeout";
  hold_timeout_minutes: number;
  tick_seconds: number;
}

export interface ResolvedChapter {
  chapter_id: string;
  name: string;
  kind: StartKind;
  start: string | null;
  nominal: string;
  pending_condition: boolean;
  fade_minutes: number;
  color?: string | null;
  variants: Variant[];
  forced_variant?: string | null;
  enabled: boolean;
  note: string;
  source: "template" | "day";
  music: (MusicAction & { scene?: string })[];
  hold?: ChapterHold | null;
  held_by?: string | null;
  start_entity?: string | null;
}

export interface CarryOver {
  chapter_id: string;
  name: string;
  color?: string | null;
  until: string | null;
}

export interface SpotifyItem {
  uri: string;
  name: string;
  type: "playlist" | "album" | "artist";
  subtitle: string;
  extra: string;
  image: string | null;
  image_large: string | null;
}

export interface CalendarEvent {
  calendar: string;
  summary: string | null;
  start: string;
  end: string;
  all_day: boolean;
  location?: string | null;
}

export interface DayView {
  date: string;
  template_id: string | null;
  template_name: string | null;
  plan: DayPlan | null;
  chapters: ResolvedChapter[];
  auto_windows: TimeWindow[];
  auto_mode: string;
  occupied: boolean | null;
  events: CalendarEvent[];
  sunrise: string | null;
  sunset: string | null;
  carry_over?: CarryOver | null;
}

export interface ManualHold {
  active: boolean;
  since?: string | null;
  until?: string | null;
  reason: string;
}

export interface EngineStatus {
  ha_connected: boolean;
  dry_run: boolean;
  now: string;
  timezone: string;
  auto_active: boolean;
  auto_reason: string;
  auto_override: "none" | "on" | "off";
  date: string;
  template_id: string | null;
  template_name: string | null;
  chapter: { id: string; name: string; start: string | null; fade_minutes: number; color?: string | null; note: string; kind: StartKind } | null;
  variant: { key: string; label: string } | null;
  scenes: { id: string; name: string; color?: string | null }[];
  next_chapter: { id: string; name: string; at: string; pending_condition: boolean; kind: StartKind } | null;
  sky: { state: SkyState | null; lux: number | null; elevation: number | null; reason: string; weather: string | null; lux_entity: string | null };
  motion: { active: boolean | null; entity: string | null; last_on: string | null };
  asleep: boolean | null;
  occupied: boolean | null;
  hold: ManualHold;
  sun: { sunrise: string | null; sunset: string | null; elevation: number | null };
  zones: Record<string, number>;
  fading: { led: string; want: string; until: string }[];
  timeline: ResolvedChapter[];
  carry_over?: CarryOver | null;
  chapter_hold?: { chapter: string; chapter_id: string; entity_id: string; label?: string | null; while_state: string; until: string | null } | null;
  last_apply: { date: string; chapter_id: string; variant_key: string | null; at: string; scenes: string[] } | null;
}

export interface HAEntity {
  entity_id: string;
  name: string;
  state: string;
  device_class?: string | null;
  unit?: string | null;
  keypad?: string | null;
  scene?: string | null;
  source_list?: string[] | null;
}

export interface LogEntry {
  seq: number;
  ts: number;
  level: string;
  kind: string;
  message: string;
  detail: unknown;
}

export interface Boot {
  basePath: string;
  version: string;
  user: { name: string; via: string } | null;
  googleLogin: boolean;
}
