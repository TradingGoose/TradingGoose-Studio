export function resolveFireworksWireModel(model: string): string {
  if (!/^fireworks\/accounts\/[^/]+\/models\/[^/]+$/.test(model)) {
    throw new Error('Fireworks model IDs must use fireworks/accounts/<account>/models/<model>')
  }
  return model.slice('fireworks/'.length)
}
