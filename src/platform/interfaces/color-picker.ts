export interface PickedColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
  colorSpace: string;
}

export interface ColorPickerAPI {
  pickColor(): Promise<PickedColor | null>;
}
