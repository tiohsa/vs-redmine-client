export type UploadFailure = {
  path: string;
  reason: string;
};

export type UploadSummary = {
  failures: UploadFailure[];
  permissionDenied: boolean;
};
