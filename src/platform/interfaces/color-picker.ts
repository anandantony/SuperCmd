export interface ColorPickerAPI {
  pickColor(): Promise<string | null>;
}
