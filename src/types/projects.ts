export type Project = Readonly<{
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}>;

export type CreateProjectInput = Readonly<{ name: string }>;

export type UpdateProjectInput = Readonly<{ id: string; name: string }>;
