declare module '@echogarden/fvad-wasm' {
  interface FvadModule {
    HEAP16: Int16Array;
    _fvad_new(): number;
    _fvad_free(instancePtr: number): void;
    _fvad_set_mode(instancePtr: number, mode: number): number;
    _fvad_set_sample_rate(instancePtr: number, sampleRate: number): number;
    _fvad_process(instancePtr: number, framePtr: number, frameLengthSamples: number): number;
    _malloc(size: number): number;
    _free(ptr: number): void;
  }

  type FvadFactory = (moduleArg?: Record<string, unknown>) => Promise<FvadModule>;

  const createFvadModule: FvadFactory;
  export default createFvadModule;
}
