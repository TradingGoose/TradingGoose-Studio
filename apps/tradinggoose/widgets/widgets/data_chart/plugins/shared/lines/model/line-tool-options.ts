import {
	DeepPartial,
	LineToolOptionsInternal,
	LineToolType,
	buildToolOptions,
} from '../../../core';

export const buildLineToolOptions = <
	TTarget extends LineToolType,
	TBase extends LineToolType = TTarget,
>(
	defaults: LineToolOptionsInternal<TBase>,
	options?: DeepPartial<LineToolOptionsInternal<TTarget>>,
	...overrides: Array<Record<string, unknown> | undefined>
): LineToolOptionsInternal<TTarget> => {
	const typedDefaults = defaults as unknown as LineToolOptionsInternal<TTarget>;
	const typedOverrides = overrides as Array<DeepPartial<LineToolOptionsInternal<TTarget>> | undefined>;
	return buildToolOptions(typedDefaults, ...typedOverrides, options);
};
