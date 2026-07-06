import type {
  WorkspaceDirectoryChildState,
  WorkspaceDirectoryEntry,
} from "../../../services/tauri";

export type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children: FileTreeNode[];
  isLazyLoadable?: boolean;
  childState?: WorkspaceDirectoryChildState;
  hasMore?: boolean;
};

export type VisibleTreeNodeEntry = {
  path: string;
  type: "file" | "folder" | "root";
  depth: number;
  node: FileTreeNode | null;
};

export type VisibleFileTreeRow =
  | { kind: "node"; entry: VisibleTreeNodeEntry & { node: FileTreeNode } }
  | {
      kind: "lazy-state";
      path: string;
      depth: number;
      state: "loading" | "error" | "empty";
      error: string | null;
    };

type FileTreeBuildNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children: Map<string, FileTreeBuildNode>;
  isLazyLoadable: boolean;
  childState?: WorkspaceDirectoryChildState;
  hasMore: boolean;
};

export const EMPTY_DIRECTORIES: string[] = [];
export const EMPTY_SET: Set<string> = new Set();
const SPECIAL_DEPENDENCY_DIRECTORIES = new Set([
  "node_modules",
  ".pnpm-store",
  ".yarn",
  "bower_components",
  "vendor",
  ".venv",
  "venv",
  "env",
  "__pypackages__",
  "Pods",
  "Carthage",
  ".m2",
  ".ivy2",
  ".cargo",
]);
const SPECIAL_BUILD_ARTIFACT_DIRECTORIES = new Set([
  "target",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".angular",
  ".parcel-cache",
  ".turbo",
  ".cache",
  ".gradle",
  "CMakeFiles",
  "bin",
  "obj",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".tox",
  ".dart_tool",
]);
export const EMPTY_DIRECTORY_METADATA: WorkspaceDirectoryEntry[] = [];
// Lowered from 250: on WebKitGTK (Tauri's Linux webview) an un-virtualized tree
// of even ~40 rows (each with 2 inline SVGs + hover selectors) causes multi-second
// style-recalc/paint. Virtualizing at 30 keeps the live DOM small; the virtual
// path already applies `contain` and is the production path for large trees.
export const FILE_TREE_VIRTUALIZATION_THRESHOLD = 30;

export function isSameOrDescendantFileTreePath(path: string, rootPath: string) {
  return path === rootPath || path.startsWith(`${rootPath}/`);
}

export function isSuppressedFileTreePath(path: string, suppressedPaths: Set<string>) {
  for (const suppressedPath of suppressedPaths) {
    if (isSameOrDescendantFileTreePath(path, suppressedPath)) {
      return true;
    }
  }
  return false;
}

export function filterSuppressedFileTreePaths(paths: Set<string>, suppressedPaths: Set<string>) {
  if (suppressedPaths.size === 0 || paths.size === 0) {
    return paths;
  }
  let changed = false;
  const next = new Set<string>();
  paths.forEach((path) => {
    if (isSuppressedFileTreePath(path, suppressedPaths)) {
      changed = true;
      return;
    }
    next.add(path);
  });
  return changed ? next : paths;
}

export function filterDeletedFileTreePathFromSet(paths: Set<string>, deletedPath: string) {
  if (paths.size === 0) {
    return paths;
  }
  let changed = false;
  const next = new Set<string>();
  paths.forEach((path) => {
    if (isSameOrDescendantFileTreePath(path, deletedPath)) {
      changed = true;
      return;
    }
    next.add(path);
  });
  return changed ? next : paths;
}

export function filterDeletedFileTreePathFromMap<T>(valuesByPath: Map<string, T>, deletedPath: string) {
  if (valuesByPath.size === 0) {
    return valuesByPath;
  }
  let changed = false;
  const next = new Map<string, T>();
  valuesByPath.forEach((value, path) => {
    if (isSameOrDescendantFileTreePath(path, deletedPath)) {
      changed = true;
      return;
    }
    next.set(path, value);
  });
  return changed ? next : valuesByPath;
}

function getFileTreePathLeaf(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function isDirectlyGitignoredFolderPath(path: string, ignoredDirectories: Set<string>) {
  if (ignoredDirectories.has(path)) {
    return true;
  }
  const pathLeaf = getFileTreePathLeaf(path);
  for (const ignoredDirectory of ignoredDirectories) {
    if (!ignoredDirectory) {
      continue;
    }
    const ignoredLeaf = getFileTreePathLeaf(ignoredDirectory);
    if (
      pathLeaf === ignoredDirectory ||
      pathLeaf === ignoredLeaf
    ) {
      return true;
    }
  }
  return false;
}

export function isGitignoredFileTreeNode(
  node: FileTreeNode,
  ignoredFiles: Set<string>,
  ignoredDirectories: Set<string>,
  memo: Map<string, boolean>,
): boolean {
  const memoized = memo.get(node.path);
  if (memoized !== undefined) {
    return memoized;
  }
  if (node.type === "file") {
    const ignored = ignoredFiles.has(node.path) ||
      Array.from(ignoredDirectories).some((ignoredDirectory) =>
        isSameOrDescendantFileTreePath(node.path, ignoredDirectory),
      );
    memo.set(node.path, ignored);
    return ignored;
  }
  if (isDirectlyGitignoredFolderPath(node.path, ignoredDirectories)) {
    memo.set(node.path, true);
    return true;
  }
  const ignored = node.children.length > 0 &&
    node.children.every((child) =>
      isGitignoredFileTreeNode(child, ignoredFiles, ignoredDirectories, memo),
    );
  memo.set(node.path, ignored);
  return ignored;
}

export function getGitignoredFolderAncestorPaths(
  folderPaths: Set<string>,
  ignoredDirectories: Set<string>,
) {
  const ancestors = new Set<string>();
  if (folderPaths.size === 0 || ignoredDirectories.size === 0) {
    return ancestors;
  }

  folderPaths.forEach((folderPath) => {
    if (!isDirectlyGitignoredFolderPath(folderPath, ignoredDirectories)) {
      return;
    }
    const parts = folderPath.split("/").filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      ancestors.add(parts.slice(0, index).join("/"));
    }
  });

  return ancestors;
}

export function isSpecialDirectoryPath(path: string) {
  const leaf = path.split("/").filter(Boolean).pop() ?? "";
  if (!leaf) {
    return false;
  }
  return (
    SPECIAL_DEPENDENCY_DIRECTORIES.has(leaf) ||
    SPECIAL_BUILD_ARTIFACT_DIRECTORIES.has(leaf) ||
    leaf.startsWith("cmake-build-")
  );
}

export function buildTree(
  files: string[],
  directories: string[],
  lazyLoadableDirectories: Set<string>,
  directoryMetadataByPath: Map<string, WorkspaceDirectoryEntry>,
): { nodes: FileTreeNode[]; folderPaths: Set<string> } {
  const root = new Map<string, FileTreeBuildNode>();
  const addNode = (
    map: Map<string, FileTreeBuildNode>,
    name: string,
    path: string,
    type: "file" | "folder",
    isLazyLoadable = false,
    childState?: WorkspaceDirectoryChildState,
    hasMore = false,
  ) => {
    const existing = map.get(name);
    if (existing) {
      if (type === "folder") {
        existing.type = "folder";
      }
      if (isLazyLoadable) {
        existing.isLazyLoadable = true;
      }
      if (childState) {
        existing.childState = childState;
      }
      if (hasMore) {
        existing.hasMore = true;
      }
      return existing;
    }
    const node: FileTreeBuildNode = {
      name,
      path,
      type,
      children: new Map(),
      isLazyLoadable,
      childState,
      hasMore,
    };
    map.set(name, node);
    return node;
  };

  const insertPath = (path: string, leafType: "file" | "folder") => {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) {
      return;
    }
    let currentMap = root;
    let currentPath = "";
    parts.forEach((segment, index) => {
      const isLeaf = index === parts.length - 1;
      const nextPath = currentPath ? `${currentPath}/${segment}` : segment;
      const nodeType: "file" | "folder" = isLeaf ? leafType : "folder";
      const metadata = nodeType === "folder" ? directoryMetadataByPath.get(nextPath) : undefined;
      const node = addNode(
        currentMap,
        segment,
        nextPath,
        nodeType,
        nodeType === "folder" && lazyLoadableDirectories.has(nextPath),
        metadata?.child_state,
        Boolean(metadata?.has_more),
      );
      if (nodeType === "folder") {
        currentMap = node.children;
        currentPath = nextPath;
      }
    });
  };

  directories.forEach((path) => insertPath(path, "folder"));
  files.forEach((path) => insertPath(path, "file"));

  const folderPaths = new Set<string>();

  const sortNodes = (a: FileTreeBuildNode, b: FileTreeBuildNode) => {
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  };

  const collapseFolderChain = (
    start: FileTreeBuildNode,
  ): { node: FileTreeBuildNode; label: string; path: string } => {
    let node = start;
    const labels = [start.name];
    let path = start.path;

    for (;;) {
      const children = Array.from(node.children.values());
      const hasDirectFile = children.some((child) => child.type === "file");
      const directFolders = children.filter((child) => child.type === "folder");
      const hasLazyLoadableChild = directFolders.some((child) => child.isLazyLoadable);
      if (node.isLazyLoadable || hasDirectFile || hasLazyLoadableChild || directFolders.length !== 1) {
        break;
      }
      const next = directFolders[0];
      if (!next) {
        break;
      }
      labels.push(next.name);
      node = next;
      path = node.path;
    }

    return {
      node,
      label: labels.join("."),
      path,
    };
  };

  const toArray = (map: Map<string, FileTreeBuildNode>): FileTreeNode[] => {
    const nodes = Array.from(map.values())
      .sort(sortNodes)
      .map((node) => {
        if (node.type === "folder") {
          const collapsed = collapseFolderChain(node);
          folderPaths.add(collapsed.path);
          return {
            name: collapsed.label,
            path: collapsed.path,
            type: "folder" as const,
            children: toArray(collapsed.node.children),
            isLazyLoadable: collapsed.node.isLazyLoadable,
            childState: collapsed.node.childState,
            hasMore: collapsed.node.hasMore,
          };
        }
        return {
          name: node.name,
          path: node.path,
          type: "file" as const,
          children: [],
        };
      });
    return nodes;
  };

  return { nodes: toArray(root), folderPaths };
}

const imageExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "avif",
  "bmp",
  "heic",
  "heif",
  "tif",
  "tiff",
]);

export function isImagePath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return imageExtensions.has(ext);
}

export function resolveWorkspaceRootLabel(workspacePath: string, workspaceName?: string) {
  const fromName = workspaceName?.trim();
  if (fromName) {
    return fromName;
  }
  const normalizedPath = workspacePath.replace(/[\\/]+$/, "");
  const segments = normalizedPath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || normalizedPath || "workspace";
}
