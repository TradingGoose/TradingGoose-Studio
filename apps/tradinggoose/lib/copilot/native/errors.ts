export class NativeTargetError extends Error {
  constructor(
    message: string,
    public status = 409
  ) {
    super(message)
    this.name = 'NativeTargetError'
  }
}
