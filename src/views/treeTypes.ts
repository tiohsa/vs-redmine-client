export type TreeSource<T> = {
  id: number;
  parentId?: number;
  label: string;
  data: T;
};

export type TreeNode<T> = {
  id: number;
  parentId?: number;
  label: string;
  data: T;
  level: number;
  children: TreeNode<T>[];
};

export type TreeBuildResult<T> = {
  roots: TreeNode<T>[];
  cycleIds: Set<number>;
};
