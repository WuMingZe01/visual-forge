export type ConversionDriver = 'visual' | 'pain_point' | 'emotional';

export interface PaletteColor {
  role: 'background' | 'text_primary' | 'accent' | 'secondary';
  hex: string;
}

export type ColorTemp = 'warm' | 'cool' | 'neutral';

export interface StyleLockConfig {
  palette: PaletteColor[];
  colorTemp: ColorTemp;
  headingFont: string;
  bodyFont: string;
  backgroundSystem: string;
  lightingSystem: string;
  layoutSystem: string;
  iconSystem: string;
  productRules: string;
  noDrift: string;
}

export interface StyleLock {
  config: StyleLockConfig;
  lockText: string;
}

export interface ProductInputData {
  category: string;
  sellingPoints: string[];
  targetAudience: string;
  proofAssets: string;
}

export interface DriverDiagnosis {
  driver: ConversionDriver;
  confidence: number;
  signals: { visual: number; painPoint: number; emotional: number };
}

export interface TextElement {
  role: 'headline' | 'subtitle' | 'label' | 'cta';
  hex: string;
  ptSize: number;
  content: string;
}

export type ScreenId = string;

export type CameraAngleId =
  | 'front34'
  | 'overhead'
  | 'side90'
  | 'rear45'
  | 'lowAngle'
  | 'macro';

export type ShotTypeId = 'wide' | 'medium' | 'closeup' | 'macro';

export interface CameraAngleDef {
  id: CameraAngleId;
  label: string;
  text: string;
  isWide: boolean;
}

export interface ShotTypeDef {
  id: ShotTypeId;
  label: string;
  text: string;
}

export interface ImagePlanItem {
  screenId: ScreenId;
  seqIndex: number;
  purpose: string;
  aspectRatio: string;
  templateId: string;
  cameraAngleId: CameraAngleId;
  cameraAngleText: string;
  shotTypeId: ShotTypeId;
  bgHex: string;
  productRatio: number;
  whitespaceRate: number;
  ecommerceStructure: string;
  textElements: TextElement[];
  platformOverlay: boolean;
  logoCorner: boolean;
  isMainImage: boolean;
  isDetailPage: boolean;
}

export interface FullImagePlan {
  driver: ConversionDriver;
  items: ImagePlanItem[];
  totalWide: number;
  maxWide: number;
  angleDistribution: Record<CameraAngleId, number>;
}

export interface AssembledPrompt {
  screenId: ScreenId;
  prompt: string;
  imagePlan: ImagePlanItem;
}

export interface BatchGenerationResult {
  driver: ConversionDriver;
  styleLock: StyleLock;
  imagePlan: ImagePlanItem[];
  prompts: AssembledPrompt[];
  results: Record<ScreenId, string[]>;
  createdAt: string;
}
