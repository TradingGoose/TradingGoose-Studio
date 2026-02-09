// /src/model/tool-registry.ts

import { LineToolType } from '../types';
import { BaseLineTool } from './base-line-tool';

/**
 * A registry for mapping line tool type names to their corresponding class constructors.
 *
 * This class ensures that when a tool is requested by its string identifier (e.g., `'Rectangle'`),
 * the plugin can reliably retrieve the correct class constructor to dynamically instantiate the tool.
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale item.
 */
export class ToolRegistry<HorzScaleItem> {
	/**
	 * Private map to store the registered tool classes.
	 * Key: {@link LineToolType} string (e.g., 'Rectangle')
	 * Value: Constructor of a class that extends {@link BaseLineTool}
	 * @private
	 */
	private readonly _toolConstructors = new Map<LineToolType, new (...args: any[]) => BaseLineTool<HorzScaleItem>>();

	/**
	 * Registers a new line tool class with the registry.
	 *
	 * This method is typically called via the public {@link LineToolsCorePlugin.registerLineTool} API
	 * to make a custom tool available for creation.
	 *
	 * @param type - The string identifier for the tool (e.g., 'Rectangle').
	 * @param toolClass - The constructor of the class that extends {@link BaseLineTool}.
	 * @returns void
	 */
	public registerTool(
		type: LineToolType,
		toolClass: new (...args: any[]) => BaseLineTool<HorzScaleItem>
	): void {
		if (this._toolConstructors.has(type)) {
			console.warn(`Line tool type "${type}" is already registered and will be overwritten.`);
		}
		this._toolConstructors.set(type, toolClass);
	}

	/**
	 * Checks if a line tool of a specific type has been registered.
	 *
	 * @param type - The line tool type to check.
	 * @returns `true` if the tool is registered, otherwise `false`.
	 */
	public isRegistered(type: LineToolType): boolean {
		return this._toolConstructors.has(type);
	}

	/**
	 * Retrieves the constructor for a specific line tool type.
	 *
	 * @param type - The line tool type to retrieve.
	 * @returns The class constructor if found.
	 * @throws Will throw an error if the tool type is not registered.
	 */
	public getToolClass(type: LineToolType): new (...args: any[]) => BaseLineTool<HorzScaleItem> {
		const toolClass = this._toolConstructors.get(type);
		if (!toolClass) {
			throw new Error(`Line tool type "${type}" is not registered. Ensure you have imported and registered the tool.`);
		}
		return toolClass;
	}
}