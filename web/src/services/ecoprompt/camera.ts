import type { ImagePlanItem, ShotTypeId } from '@/types/eco-types';

export const CAMERA_ANGLES = [
  { id: 'front34' as const, label: '正面3/4', text: 'at a slight 3/4 angle showing full front facade', isWide: true },
  { id: 'overhead' as const, label: '正上俯视', text: 'photographed directly from above at a 90-degree overhead angle, showing full layout', isWide: true },
  { id: 'side90' as const, label: '侧面90°', text: 'photographed from a clean 90-degree side profile, showing depth and layers', isWide: false },
  { id: 'rear45' as const, label: '后侧45°', text: 'photographed from behind at a 45-degree rear angle, revealing back details', isWide: false },
  { id: 'lowAngle' as const, label: '仰视', text: 'photographed from a very low angle looking upward, dramatic heroic perspective', isWide: true },
  { id: 'macro' as const, label: '微距特写', text: 'extreme close-up macro shot, shallow depth of field, foreground in sharp focus', isWide: false },
];

export const SHOT_TYPES: { id: ShotTypeId; label: string; text: string }[] = [
  { id: 'wide', label: '全景', text: 'full product visible, product occupies 35-40%' },
  { id: 'medium', label: '中景', text: 'showing the feature area, product occupies 45-50%' },
  { id: 'closeup', label: '特写', text: 'tight zoom on specific detail, product detail occupies 55-60%' },
  { id: 'macro', label: '微距', text: 'extreme close-up, shallow depth of field' },
];

const ANGLE_BY_INDEX = [
  'front34', 'overhead', 'side90', 'macro', 'lowAngle', 'rear45',
] as const;

const WIDE_IDS = ['front34', 'overhead', 'lowAngle'];

export function assignCameraAngles(items: ImagePlanItem[]): ImagePlanItem[] {
  const assigned: ImagePlanItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let angleId: typeof ANGLE_BY_INDEX[number] = ANGLE_BY_INDEX[i % ANGLE_BY_INDEX.length];

    if (i >= 2) {
      const prev1 = assigned[i - 1];
      const prev2 = assigned[i - 2];
      if (prev1 && prev2 && prev1.cameraAngleId === angleId && prev2.cameraAngleId === angleId) {
        angleId = ANGLE_BY_INDEX[(i + 2) % ANGLE_BY_INDEX.length];
      }
    }

    let wideCount = 0;
    for (let j = 0; j < i; j++) {
      if (WIDE_IDS.includes(assigned[j].cameraAngleId)) {
        wideCount++;
      }
    }
    if (WIDE_IDS.includes(angleId)) {
      wideCount++;
    }

    const maxWide = Math.floor((i + 1) * 0.4);
    if (wideCount > maxWide) {
      const nonWide = ANGLE_BY_INDEX.filter((id) => !WIDE_IDS.includes(id));
      angleId = nonWide[(i + 3) % nonWide.length];
    }

    const angleDef = CAMERA_ANGLES.find((a) => a.id === angleId)!;
    assigned.push({
      ...item,
      cameraAngleId: angleId,
      cameraAngleText: angleDef.text,
    });
  }

  return assigned;
}
