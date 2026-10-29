export function resolveFireworksWireModel(model: string): string {
  if (!/^fireworks\/accounts\/[^/]+\/(?:models|deployments)\/[^/]+$/.test(model)) {
    throw new Error('Fireworks IDs must use fireworks/accounts/<account>/(models|deployments)/<id>')
  }
  return model.slice('fireworks/'.length)
}
