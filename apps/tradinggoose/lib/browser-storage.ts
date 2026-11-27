/**
 * Safe localStorage utilities with SSR support
 * Provides clean error handling and type safety for browser storage operations
 */

import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('BrowserStorage')

/**
 * Safe localStorage operations with fallbacks
 */
export class BrowserStorage {
  /**
   * Safely gets an item from localStorage
   * @param key - The storage key
   * @param defaultValue - The default value to return if key doesn't exist or access fails
   * @returns The stored value or default value
   */
  static getItem<T = string>(key: string, defaultValue: T): T {
    if (typeof window === 'undefined') {
      return defaultValue
    }

    try {
      const item = window.localStorage.getItem(key)
      if (item === null) {
        return defaultValue
      }

      try {
        return JSON.parse(item) as T
      } catch {
        return item as T
      }
    } catch (error) {
      logger.warn(`Failed to get localStorage item "${key}":`, error)
      return defaultValue
    }
  }

  /**
   * Safely sets an item in localStorage
   * @param key - The storage key
   * @param value - The value to store
   * @returns True if successful, false otherwise
   */
  static setItem<T>(key: string, value: T): boolean {
    if (typeof window === 'undefined') {
      return false
    }

    try {
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value)
      window.localStorage.setItem(key, serializedValue)
      return true
    } catch (error) {
      logger.warn(`Failed to set localStorage item "${key}":`, error)
      return false
    }
  }

  /**
   * Safely removes an item from localStorage
   * @param key - The storage key to remove
   * @returns True if successful, false otherwise
   */
  static removeItem(key: string): boolean {
    if (typeof window === 'undefined') {
      return false
    }

    try {
      window.localStorage.removeItem(key)
      return true
    } catch (error) {
      logger.warn(`Failed to remove localStorage item "${key}":`, error)
      return false
    }
  }
}
