import type { SegmentedTabsItem } from '../../ui/lucky';
import type { Hand } from '../../ui/useHandedness';
import type { UserSettings } from '../../types/game';

export type BooleanSettingKey = {
  [K in keyof UserSettings]: UserSettings[K] extends boolean ? K : never;
}[keyof UserSettings];

export interface SettingToggle {
  key: BooleanSettingKey;
  label: string;
  description?: string;
}

export const settingPatch = (key: BooleanSettingKey, value: boolean): Partial<UserSettings> => {
  const patch: Partial<UserSettings> = {};
  patch[key] = value;
  return patch;
};

export const THUMB_SIDE_COPY = {
  label: 'Thumb side',
  description: 'Which side the profile drawer opens from',
} as const;

export const HAND_ITEMS: readonly SegmentedTabsItem<Hand>[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];
