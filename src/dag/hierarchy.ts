/**
 * Before you can compute a DAG layout, you need a DAG structure.  If your data
 * is already in a DAG structure, you can use the {@link hierarchy} method to
 * generate a default {@link HierarchyOperator} which can then be used to transform
 * your data into a {@link Dag}.
 *
 * @module
 */

import {
  Dag,
  DagNode,
  LayoutChildLink,
  LayoutDagNode,
  LayoutDagRoot
} from "./node";

import { js } from "../utils";
import { verifyDag } from "./verify";

/**
 * The interface for getting child data from node data. This function must
 * return data for every child given the data for the current node. `i` will
 * increment for each node processed.
 */
interface ChildrenOperator<NodeDatum> {
  (d: NodeDatum, i: number): readonly NodeDatum[] | undefined;
}

/**
 * The interface for getting children data and associated link data from node
 * data. This function must return data for every child of the given node, and
 * data for link between the two. `i` will increment for each node processesed.
 */
interface ChildrenDataOperator<NodeDatum, LinkDatum> {
  (d: NodeDatum, i: number):
    | readonly (readonly [NodeDatum, LinkDatum])[]
    | undefined;
}

/**
 * What gets returned by {@link childrenData}() when {@link children} is set.
 */
interface WrappedChildrenOperator<
  NodeDatum,
  Children extends ChildrenOperator<NodeDatum> = ChildrenOperator<NodeDatum>
> extends ChildrenDataOperator<NodeDatum, undefined> {
  (d: NodeDatum, i: number): readonly (readonly [NodeDatum, undefined])[];
  wrapped: Children;
}

/**
 * What gets returned by {@link children}() when {@link childrenData} is set.
 */
interface WrappedChildrenDataOperator<
  NodeDatum,
  LinkDatum,
  ChildrenData extends ChildrenDataOperator<
    NodeDatum,
    LinkDatum
  > = ChildrenDataOperator<NodeDatum, LinkDatum>
> extends ChildrenOperator<NodeDatum> {
  (d: NodeDatum, i: number): readonly NodeDatum[];
  wrapped: ChildrenData;
}

/**
 * The operator that constructs a {@link Dag} from hierarchy data.
 */
export interface HierarchyOperator<
  NodeDatum = unknown,
  LinkDatum = unknown,
  Children extends ChildrenOperator<NodeDatum> = ChildrenOperator<NodeDatum>,
  ChildrenData extends ChildrenDataOperator<
    NodeDatum,
    LinkDatum
  > = ChildrenDataOperator<NodeDatum, LinkDatum>
> {
  /**
   * Construct a DAG from the specified root nodes.
   * Each root node must be an object representing a root node.
   * For example:
   *
   * ```json
   * {
   *   "id": "Eve",
   *     "children": [
   *     {
   *       "id": "Cain"
   *     },
   *     {
   *       "id": "Seth",
   *       "children": [
   *       {
   *         "id": "Enos"
   *       },
   *       {
   *         "id": "Noam"
   *       }
   *       ]
   *     },
   *     {
   *       "id": "Abel"
   *     },
   *     {
   *       "id": "Awan",
   *       "children": [
   *       {
   *         "id": "Enoch"
   *       }
   *       ]
   *     },
   *     {
   *       "id": "Azura"
   *     }
   *   ]
   * }
   * ```
   */
  // NOTE we can't infer data type for hierarchy generator because the children
  // and children data method also has to be typed
  (...data: readonly NodeDatum[]): Dag<DagNode<NodeDatum, LinkDatum>>;

  /**
   * Sets the children accessor to the given {@link ChildrenOperator} and returns
   * this {@link HierarchyOperator}. The default operator is:
   *
   * ```js
   * function children(d) {
   *   return d.children;
   * }
   * ```
   */
  children<NewDatum, NewChildren extends ChildrenOperator<NewDatum>>(
    ids: NewChildren &
      ((d: NewDatum, i: number) => readonly NewDatum[] | undefined)
  ): HierarchyOperator<
    NewDatum,
    undefined,
    NewChildren,
    WrappedChildrenOperator<NewDatum, NewChildren>
  >;
  /**
   * Gets the current {@link ChildrenOperator}, If {@link childrenData} was specified,
   * this will return a wrapped version that returns only the children of that
   * operator.
   */
  children(): Children;

  /**
   * Sets the childrenData accessor to the given {@link ChildrenDataOperator} and
   * returns this {@link HierarchyOperator}.
   */
  childrenData<
    NewDatum,
    NewLinkDatum,
    NewChildrenData extends ChildrenDataOperator<NewDatum, NewLinkDatum>
  >(
    data: NewChildrenData &
      ((
        d: NewDatum,
        i: number
      ) => readonly (readonly [NewDatum, NewLinkDatum])[] | undefined)
  ): HierarchyOperator<
    NewDatum,
    NewLinkDatum,
    WrappedChildrenDataOperator<NewDatum, NewLinkDatum, NewChildrenData>,
    NewChildrenData
  >;
  /**
   * Get the current childrenData operator. If {@link children} was specified, this
   * will return a wrapped version that returns undefined data.
   */
  childrenData(): ChildrenData;
}

/** @internal */
function buildOperator<
  NodeDatum,
  LinkDatum,
  Children extends ChildrenOperator<NodeDatum>,
  ChildrenData extends ChildrenDataOperator<NodeDatum, LinkDatum>
>(
  childrenOp: Children,
  childrenDataOp: ChildrenData
): HierarchyOperator<NodeDatum, LinkDatum, Children, ChildrenData> {
  function hierarchy(...data: NodeDatum[]): Dag<DagNode<NodeDatum, LinkDatum>> {
    if (!data.length) {
      throw new Error("must pass in at least one node");
    }

    const mapping = new Map<NodeDatum, DagNode<NodeDatum, LinkDatum>>();
    const queue: DagNode<NodeDatum, LinkDatum>[] = [];

    function nodify(datum: NodeDatum): DagNode<NodeDatum, LinkDatum> {
      let node = mapping.get(datum);
      if (node === undefined) {
        node = new LayoutDagNode(datum);
        mapping.set(datum, node);
        queue.push(node);
      }
      return node;
    }
    const roots = data.map(nodify);
    let node;
    let i = 0;
    while ((node = queue.pop())) {
      node.dataChildren = (childrenDataOp(node.data, i++) || []).map(
        ([childDatum, linkDatum]) =>
          new LayoutChildLink(nodify(childDatum), linkDatum)
      );
    }

    // verifty roots are roots
    const rootSet = new Set(roots);
    for (const node of mapping.values()) {
      if (node.ichildren().some((child) => rootSet.has(child))) {
        throw new Error(js`node '${node.data}' pointed to a root`);
      }
    }

    // create dag
    verifyDag(roots);
    return roots.length > 1 ? new LayoutDagRoot(roots) : roots[0];
  }

  function children(): Children;
  function children<NewDatum, NewChildren extends ChildrenOperator<NewDatum>>(
    childs: NewChildren
  ): HierarchyOperator<
    NewDatum,
    undefined,
    NewChildren,
    WrappedChildrenOperator<NewDatum, NewChildren>
  >;
  function children<NewDatum, NewChildren extends ChildrenOperator<NewDatum>>(
    childs?: NewChildren
  ):
    | Children
    | HierarchyOperator<
        NewDatum,
        undefined,
        NewChildren,
        WrappedChildrenOperator<NewDatum, NewChildren>
      > {
    if (childs === undefined) {
      return childrenOp;
    } else {
      return buildOperator<
        NewDatum,
        undefined,
        NewChildren,
        WrappedChildrenOperator<NewDatum, NewChildren>
      >(childs, wrapChildren(childs));
    }
  }
  hierarchy.children = children;

  function childrenData(): ChildrenData;
  function childrenData<
    NewDatum,
    NewLinkDatum,
    NewChildrenData extends ChildrenDataOperator<NewDatum, NewLinkDatum>
  >(
    data: NewChildrenData
  ): HierarchyOperator<
    NewDatum,
    NewLinkDatum,
    WrappedChildrenDataOperator<NewDatum, NewLinkDatum, NewChildrenData>,
    NewChildrenData
  >;
  function childrenData<
    NewDatum,
    NewLinkDatum,
    NewChildrenData extends ChildrenDataOperator<NewDatum, NewLinkDatum>
  >(
    data?: NewChildrenData
  ):
    | ChildrenData
    | HierarchyOperator<
        NewDatum,
        NewLinkDatum,
        WrappedChildrenDataOperator<NewDatum, NewLinkDatum, NewChildrenData>,
        NewChildrenData
      > {
    if (data === undefined) {
      return childrenDataOp;
    } else {
      return buildOperator<
        NewDatum,
        NewLinkDatum,
        WrappedChildrenDataOperator<NewDatum, NewLinkDatum, NewChildrenData>,
        NewChildrenData
      >(wrapChildrenData(data), data);
    }
  }
  hierarchy.childrenData = childrenData;

  return hierarchy;
}

/** @internal */
function wrapChildren<NodeDatum, Children extends ChildrenOperator<NodeDatum>>(
  children: Children
): WrappedChildrenOperator<NodeDatum, Children> {
  function wrapped(d: NodeDatum, i: number): [NodeDatum, undefined][] {
    return (children(d, i) || []).map((d) => [d, undefined]);
  }
  wrapped.wrapped = children;
  return wrapped;
}

/** @internal */
function wrapChildrenData<
  NodeDatum,
  LinkDatum,
  ChildrenData extends ChildrenDataOperator<NodeDatum, LinkDatum>
>(
  childrenData: ChildrenData
): WrappedChildrenDataOperator<NodeDatum, LinkDatum, ChildrenData> {
  function wrapped(d: NodeDatum, i: number): NodeDatum[] {
    return (childrenData(d, i) || []).map(([d]) => d);
  }
  wrapped.wrapped = childrenData;
  return wrapped;
}

/** @internal */
interface HasChildren<NodeDatum> {
  children: NodeDatum[] | undefined;
}

/** @internal */
function hasChildren<NodeDatum>(d: unknown): d is HasChildren<NodeDatum> {
  try {
    const children = (d as HasChildren<NodeDatum>).children;
    return children === undefined || children instanceof Array;
  } catch {
    return false;
  }
}

/** @internal */
function defaultChildren<NodeDatum>(d: NodeDatum): NodeDatum[] | undefined {
  if (hasChildren<NodeDatum>(d)) {
    return d.children;
  } else {
    throw new Error(
      js`default children function expected datum to have a children field but got: ${d}`
    );
  }
}

/**
 * Constructs a new {@link HierarchyOperator} with default settings.
 *
 * By default ids will be pulled from the `id` property and children will be
 * pulled from the `children` property. Since `children` being undefined is
 * valid, forgetting to set children properly will result in a dag with only a
 * single node.
 */
export function hierarchy(
  ...args: never[]
): HierarchyOperator<
  unknown,
  undefined,
  ChildrenOperator<unknown>,
  WrappedChildrenOperator<unknown, ChildrenOperator<unknown>>
> {
  if (args.length) {
    throw Error(
      `got arguments to dagHierarchy(${args}), but constructor takes no aruguments. ` +
        "These were probably meant as data which should be called as dagHierarchy()(...)"
    );
  }
  return buildOperator(defaultChildren, wrapChildren(defaultChildren));
}
