export type TreeSource<T> = {
  id: number;
  parentId?: number;
  label: string;
  data: T;
  /** 親チケットが現在のビューに含まれていない場合に true */
  parentNotLoaded?: boolean;
};

export type TreeNode<T> = {
  id: number;
  parentId?: number;
  label: string;
  data: T;
  level: number;
  children: TreeNode<T>[];
  /** 親チケットが現在のビューに含まれていない場合に true */
  parentNotLoaded?: boolean;
};

export type TreeBuildResult<T> = {
  roots: TreeNode<T>[];
  cycleIds: Set<number>;
};
