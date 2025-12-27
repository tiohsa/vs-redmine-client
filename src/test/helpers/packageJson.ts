import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

type PackageJson = Record<string, unknown>;

export type MenuItem = {
  command: string;
  when?: string;
  group?: string;
  enablement?: string;
  icon?: string | { light: string; dark: string };
};

export type CommandItem = {
  command: string;
  title?: string;
  icon?: string | { light: string; dark: string };
};

export const loadPackageJson = (): PackageJson => {
  const packageJsonPath = path.resolve(__dirname, "../../../package.json");
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  return JSON.parse(raw) as PackageJson;
};

export const getContributes = (): Record<string, unknown> => {
  const packageJson = loadPackageJson();
  const contributes = packageJson.contributes as Record<string, unknown> | undefined;
  assert.ok(contributes, "contributes must be defined");
  return contributes;
};

export const getCommands = (): CommandItem[] => {
  const contributes = getContributes();
  const commands = contributes.commands as CommandItem[] | undefined;
  assert.ok(commands, "commands must be defined");
  return commands;
};

export const getViewTitleMenuItems = (): MenuItem[] => {
  return getMenuItems("view/title");
};

export const getMenuItems = (menuId: string): MenuItem[] => {
  const contributes = getContributes();
  const menus = contributes.menus as Record<string, MenuItem[]> | undefined;
  assert.ok(menus, "menus must be defined");
  const items = menus[menuId] as MenuItem[] | undefined;
  assert.ok(items, `${menuId} menu must be defined`);
  return items;
};
