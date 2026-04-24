import {
  sortExecutionGroups,
  getExecutionAggregate,
  getExecutionGroupValue,
  type MonitorExecutionItem,
} from '../data/execution-ordering'
import type { MonitorFieldSum, MonitorViewConfig } from '../view/view-config'

export type MonitorRoadmapItem = {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  item: MonitorExecutionItem;
};

export type MonitorRoadmapGroup = {
  id: string;
  label: string;
  items: MonitorRoadmapItem[];
  aggregates: Partial<Record<MonitorFieldSum, number>>;
};

export const buildMonitorRoadmapGroups = (
  items: MonitorExecutionItem[],
  config: MonitorViewConfig,
): MonitorRoadmapGroup[] => {
  const groups = new Map<string, MonitorRoadmapGroup>();
  const groupField = config.sliceBy ?? config.groupBy;
  const groupValues = new Map<string, ReturnType<typeof getExecutionGroupValue>>();

  items.forEach((item) => {
    const value = getExecutionGroupValue(item, groupField);
    groupValues.set(value.id, value);
    const group = groups.get(value.id) ?? {
      id: value.id,
      label: value.label,
      items: [],
      aggregates: {},
    };

    group.items.push({
      id: item.logId,
      title: `${item.listingLabel} · ${item.workflowName}`,
      startAt: new Date(item.startedAt),
      endAt: new Date(item.endedAt ?? item.startedAt),
      item,
    });

    groups.set(value.id, group);
  });

  return sortExecutionGroups(
    Array.from(groups.values()),
    groupField,
    (group) =>
      groupValues.get(group.id) ?? {
        id: group.id,
        label: group.label,
        sortValue: group.label,
      }
  )
    .map((group) => ({
      ...group,
      aggregates: Object.fromEntries(
        config.fieldSums.map((field) => [
          field,
          getExecutionAggregate(
            group.items.map((item) => item.item),
            field,
          ),
        ]),
      ) as Partial<Record<MonitorFieldSum, number>>,
    }));
};
