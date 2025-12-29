import * as fb from "flatbuffers";
import * as go from "./golang";
import * as program from "../program";
import { FuncType, Kind, Type, TypeDef } from "./types";

export type NodeId = bigint;

export interface GoBuilderOptions {
  size?: number; // Initial size allocated towards the builder.
  name?: string; // Program name (used when exporting).

  hookChunkSize?: number; // Max size in bytes of each chunk when streaming.
}

export interface NodeValue {
  type?: TypeDef;
  value: string | NodeId;
  flags: number;
}

export interface Node {
  opcode: go.Opcode;
  parent?: NodeId;
  next?: NodeId;
  flags: number;
  // Indexed Node
  id?: string;
  fields?: NodeValue[];
  // Binary Node
  left?: NodeValue;
  right?: NodeValue;
  // Unary Node
  value?: NodeValue;
}

export interface FuncDef {
  type: TypeDef; // Must be of FuncType
  params?: NodeId[]; // Input parameters
  body?: NodeId[]; // Array of node id
}

export class GoBuilder {
  private builder: fb.Builder;
  private stringlut: Map<number, string> = new Map();
  private nodes: Map<bigint, [Node, fb.Offset]> = new Map();

  constructor(private options: GoBuilderOptions) {
    const defaultSize = 1024;
    this.builder = new fb.Builder(options.size || defaultSize);
  }

  private buildNode(node: Node): fb.Offset {
    let nodeType: number = 0;
    let nodeContentOffset: fb.Offset = 0;
    switch (node.flags) {
      case go.NodeFlag.NodeIndexed:
        nodeType = program.NodeUnion.IndexedNode;
        nodeContentOffset = this.CreateIndexedNode(node);
        break;
      case go.NodeFlag.NodeBinary:
        nodeType = program.NodeUnion.BinaryNode;
        nodeContentOffset = this.CreateBinaryNode(node);
        break;
      case go.NodeFlag.NodeUnary:
        nodeType = program.NodeUnion.UnaryNode;
        nodeContentOffset = this.CreateUnaryNode(node);
        break;
      default:
        nodeType = program.NodeUnion.NONE;
        break;
    }
    program.Node.startNode(this.builder);
    program.Node.addOpcode(this.builder, node.opcode);
    program.Node.addParent(this.builder, node.parent || 0n);
    program.Node.addNext(this.builder, node.next || 0n);
    program.Node.addFlags(this.builder, node.flags);
    program.Node.addNodeType(this.builder, nodeType);
    program.Node.addNode(this.builder, nodeContentOffset);
    return program.Node.endNode(this.builder);
  }

  public SetNode(node: Node, id?: bigint): NodeId {
    let _id = id ?? BigInt(this.nodes.size);
    if (this.nodes.has(_id)) return this.SetNode(node, ++_id); // Retry with new id if exists
    const nodeOffset = this.buildNode(node);
    this.nodes.set(_id, [node, nodeOffset]);
    return _id;
  }

  public DeleteNode(id: bigint, recursive?: boolean) {
    if (recursive) {
      const node = this.nodes.get(id);
      if (!node) {
        console.error(`Unknown id of ${id}`);
        return;
      }
      // WARN - Implement
      for (const n of node[0].fields || []) {
        if (n.flags & go.ValueFlag.Pointer) continue;

        const success = this.nodes.delete(n.value as bigint);
        if (!success)
          console.warn(`Failed to delete node part of ${id}: ${n.value}`);
      }
    }

    this.nodes.delete(id);
  }

  public UpdateNodeField(id: bigint, index: number, field: NodeValue) {
    const node = this.nodes.get(id);
    if (!node || !node[0].fields) {
      console.error(`Invalid node ${id}.`);
      return;
    }

    if (index < 0 || index > node[0].fields.length) {
      console.error(`Invalid index of ${index}.`);
      return;
    }

    node[0].fields[index] = field;
    const nodeOffset = this.buildNode(node[0]);
    this.nodes.set(id, [node[0], nodeOffset]);
  }

  public ConnectNodes(parent: bigint, child: bigint) {
    const targetNode = this.nodes.get(parent);
    if (!targetNode) {
      console.error(`Could not find node with ${parent}.`);
      return;
    }

    const sourceNode = this.nodes.get(child);
    if (!sourceNode) {
      console.error(`Could not find node with ${child}.`);
      return;
    }

    targetNode[0].next = child;
    sourceNode[0].parent = parent;
    const targetNodeOffset = this.buildNode(targetNode[0]);
    const sourceNodeOffset = this.buildNode(sourceNode[0]);
    this.nodes.set(parent, [targetNode[0], targetNodeOffset]);
    this.nodes.set(child, [sourceNode[0], sourceNodeOffset]);
  }

  public CreateNode(opcode: number, flags: number): Node {
    return {
      opcode,
      flags,
    };
  }

  public CreatePackageNode(id: string): Node {
    if (id.length <= 0)
      console.error(`Length of package id must be greater than zero!`); // WARN - Add regex check
    return {
      opcode: go.Opcode.Package,
      id,
      flags: go.NodeFlag.NodeIndexed,
    };
  }

  public CreateImportNode(...imports: NodeId[]): Node {
    return {
      opcode: go.Opcode.Import,
      fields: imports.map((v): NodeValue => {
        return {
          value: v,
          flags: go.ValueFlag.Pointer,
        };
      }),
      flags: go.NodeFlag.NodeIndexed,
    };
  }

  public CreateImportValueNode(path: string, alias?: string): Node {
    return {
      opcode: go.Opcode.ImportValue,
      left: {
        value: alias || "",
        flags: 0,
      },
      right: {
        value: path,
        flags: 0,
      },
      flags: go.NodeFlag.NodeBinary,
    };
  }

  public CreateConstNode(...constants: NodeId[]): Node {
    return {
      opcode: go.Opcode.Const,
      fields: constants.map((v) => {
        return {
          value: v,
          flags: go.ValueFlag.Pointer,
        };
      }),
      flags: go.NodeFlag.NodeIndexed,
    };
  }

  public CreateConstValueNode(
    name: string,
    type: TypeDef,
    value: string,
  ): Node {
    return {
      opcode: go.Opcode.Const,
      left: {
        type,
        value: name,
        flags: 0,
      },
      right: {
        value,
        flags: 0,
      },
      flags: go.NodeFlag.NodeIndexed,
    };
  }

  public CreateVarNode(...vars: NodeId[]): Node {
    return {
      opcode: go.Opcode.Var,
      fields: vars.map((v) => {
        return {
          value: v,
          flags: go.ValueFlag.Pointer,
        };
      }),
      flags: go.NodeFlag.NodeIndexed,
    };
  }

  public CreateVarValueNode(name: string, type: TypeDef, value: string): Node {
    return {
      opcode: go.Opcode.VarValue,
      left: {
        type,
        value: name,
        flags: 0,
      },
      right: {
        value,
        flags: 0,
      },
      flags: go.NodeFlag.NodeIndexed,
    };
  }

  public CreateTypeNode(type: TypeDef): Node {
    return {
      opcode: go.Opcode.Type,
      id: type.id,
      fields: [
        {
          type,
          value: 0n,
          flags: go.ValueFlag.None,
        },
      ],
      flags: go.NodeFlag.NodeIndexed,
    };
  }

  public CreateFuncNode(def: FuncDef): Node {
    const meta: NodeValue = {
      type: def.type,
      value: 0n,
      flags: go.ValueFlag.None,
    };

    let params: NodeValue[] = [];
    if (def.params) {
      params = def.params.map((v) => {
        return {
          value: v,
          flags: go.ValueFlag.Pointer | 0, // WARN - Add proper value flag definition
        };
      });
    }

    let body: NodeValue[] = [];
    if (def.body) {
      body = def.body?.map((v) => {
        return {
          value: v,
          flags: go.ValueFlag.Pointer | 0, // WARN - Add proper value flag definition
        };
      });
    }

    return {
      opcode: go.Opcode.Func,
      id: def.type.id,
      fields: [meta, ...params, ...body],
      flags: go.NodeFlag.NodeIndexed,
    };
  }

  public CreateIfNode(
    condition: bigint,
    body: bigint[],
    _else: bigint[],
  ): Node {
    return {
      opcode: go.Opcode.If,
      fields: [
        {
          value: condition,
          flags: go.ValueFlag.Pointer | 0, // WARN - Add proper value flag definition
        },
        ...body.map((v) => {
          return {
            value: v,
            flags: go.ValueFlag.Pointer | 0, // WARN - Add proper value flag definition
          };
        }),
        ..._else.map((v) => {
          return {
            value: v,
            flags: go.ValueFlag.Pointer | 0, // WARN - Add proper value flag definition
          };
        }),
      ],
      flags: go.NodeFlag.NodeIndexed,
    };
  }

  public CreateForNode(
    init: bigint,
    cond: bigint,
    post: bigint,
    body: bigint[],
  ): Node {
    return {
      opcode: go.Opcode.For,
      flags: go.NodeFlag.NodeIndexed,
      fields: [
        {
          value: init,
          flags: go.ValueFlag.Pointer,
        },
        {
          value: cond,
          flags: go.ValueFlag.Pointer,
        },
        {
          value: post,
          flags: go.ValueFlag.Pointer,
        },
        ...body.map((v) => {
          return {
            value: v,
            flags: go.ValueFlag.Pointer,
          };
        }),
      ],
    };
  }

  public CreateForRangeNode(
    var1: bigint, // First variable assignment
    var2: bigint, // Second varable assignment
    value: bigint, // Ranged value
  ): Node {
    return {
      opcode: go.Opcode.ForRange,
      flags: go.NodeFlag.NodeIndexed,
      fields: [
        {
          value: var1,
          flags: go.ValueFlag.Pointer,
        },
        {
          value: var2,
          flags: go.ValueFlag.Pointer,
        },
        {
          value: value,
          flags: go.ValueFlag.Pointer,
        },
      ],
    };
  }

  public CreateSwitchNode(expression: bigint, body: bigint[]): Node {
    return {
      opcode: go.Opcode.Switch,
      flags: go.NodeFlag.NodeIndexed,
      fields: [
        ...body.map((v) => {
          return {
            value: v,
            flags: go.ValueFlag.Pointer,
          };
        }),
      ],
    };
  }

  public CreateSelectNode(body: bigint[]): Node {
    return {
      opcode: go.Opcode.Select,
      flags: go.NodeFlag.NodeIndexed,
      fields: body.map((v) => {
        return {
          value: v,
          flags: go.ValueFlag.Pointer,
        };
      }),
    };
  }

  public CreateCaseNode(expression: bigint, body: bigint[]): Node {
    return {
      opcode: go.Opcode.Case,
      flags: go.NodeFlag.NodeIndexed,
      fields: [
        {
          value: expression,
          flags: go.ValueFlag.Pointer,
        },
        ...body.map((v) => {
          return {
            value: v,
            flags: go.ValueFlag.Pointer,
          };
        }),
      ],
    };
  }

  public CreateDefaultNode(body: bigint[]): Node {
    return {
      opcode: go.Opcode.Case,
      flags: go.NodeFlag.NodeIndexed,
      fields: body.map((v) => {
        return {
          value: v,
          flags: go.ValueFlag.Pointer,
        };
      }),
    };
  }

  public CreateAddNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.Add,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateSubNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.Sub,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateMulNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.Mul,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateDivNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.Div,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateModNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.Mod,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateIncNode(a: string | NodeId): Node {
    return {
      opcode: go.Opcode.Inc,
      flags: go.NodeFlag.NodeUnary,
      value: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateDecNode(a: string | NodeId): Node {
    return {
      opcode: go.Opcode.Dec,
      flags: go.NodeFlag.NodeUnary,
      value: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.Assign,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateAddAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.AddAssign,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateSubAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.SubAssign,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateMulAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.MulAssign,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateDivAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.DivAssign,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateModAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.ModAssign,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateBitAndAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.BitAndAssign,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateBitOrAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.BitOrAssign,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateBitXorAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.BitXorAssign,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateBitClearAssignNode(
    a: string | NodeId,
    b: string | NodeId,
  ): Node {
    return {
      opcode: go.Opcode.BitClearAssign,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateLeftShiftAssignNode(
    a: string | NodeId,
    b: string | NodeId,
  ): Node {
    return {
      opcode: go.Opcode.LeftShiftAssign,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateRightShiftAssignNode(
    a: string | NodeId,
    b: string | NodeId,
  ): Node {
    return {
      opcode: go.Opcode.RightShiftAssign,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateEqualNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.Equal,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateNotEqualNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.NotEqual,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateLessNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.Less,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateLessEqualNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.LessEqual,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateGreaterNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.Greater,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateGreaterEqualNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.GreaterEqual,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateAndNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.And,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateOrNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.Or,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateNotNode(a: string | NodeId): Node {
    return {
      opcode: go.Opcode.Not,
      flags: go.NodeFlag.NodeUnary,
      value: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateBitAndNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.BitAnd,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateBitOrNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.BitOr,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateBitXorNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.BitXor,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateBitClearNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.BitClear,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateLeftShiftNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.LeftShift,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateRightShiftNode(a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode: go.Opcode.RightShift,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: a,
        flags: typeof a === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
      right: {
        value: b,
        flags: typeof b === "bigint" ? go.ValueFlag.Pointer : go.ValueFlag.None,
      },
    };
  }

  public CreateChanSendNode(chan: NodeId, value: NodeId): Node {
    return {
      opcode: go.Opcode.Send,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: chan,
        flags: go.ValueFlag.Pointer,
      },
      right: {
        value: value,
        flags: go.ValueFlag.Pointer,
      },
    };
  }

  public CreateChanReceiveNode(chan: NodeId): Node {
    return {
      opcode: go.Opcode.Receive,
      flags: go.NodeFlag.NodeUnary,
      value: {
        value: chan,
        flags: go.ValueFlag.Pointer,
      },
    };
  }

  public CreateAddrOfNode(value: NodeId): Node {
    return {
      opcode: go.Opcode.AddrOf,
      flags: go.NodeFlag.NodeUnary,
      value: {
        value: value,
        flags: go.ValueFlag.Pointer,
      },
    };
  }

  public CreateDerefNode(ptr: NodeId): Node {
    return {
      opcode: go.Opcode.Deref,
      flags: go.NodeFlag.NodeUnary,
      value: {
        value: ptr,
        flags: go.ValueFlag.Pointer,
      },
    };
  }

  public CreateCallNode(funcId: string, params: (NodeId | string)[]): Node {
    return {
      opcode: go.Opcode.Call,
      flags: go.NodeFlag.NodeIndexed,
      id: funcId,
      fields: params.map((v) => {
        return {
          value: v,
          flags: go.ValueFlag.Pointer,
        };
      }),
    };
  }

  public CreateReturnNode(params: NodeId[]): Node {
    return {
      opcode: go.Opcode.Call,
      flags: go.NodeFlag.NodeIndexed,
      fields: params.map((v) => {
        return {
          value: v,
          flags: go.ValueFlag.Pointer,
        };
      }),
    };
  }

  public CreateDeferNode(call: NodeId): Node {
    return {
      opcode: go.Opcode.Defer,
      flags: go.NodeFlag.NodeUnary,
      value: {
        value: call,
        flags: go.ValueFlag.Pointer,
      },
    };
  }

  public CreateGoRoutineNode(call: NodeId): Node {
    return {
      opcode: go.Opcode.GoRoutine,
      flags: go.NodeFlag.NodeUnary,
      value: {
        value: call,
        flags: go.ValueFlag.Pointer,
      },
    };
  }

  // public CreateMapNode(mapDef: TypeDef, body: NodeId[]): Node {
  //   return { // WARN - needs attention
  //     opcode: go.Opcode.Map,
  //     flags: go.NodeFlag.NodeIndexed,
  //     fields: body.map((v) => {
  //       return {
  //         value: v,
  //         flags: go.ValueFlag.Pointer,
  //       };
  //     })
  //   };
  // }

  // public CreateArrayNode(arrayDef: TypeDef, body: NodeId[]): Node {
  //   return { // WARN - needs attention
  //     opcode: go.Opcode.Array,
  //     flags: go.NodeFlag.NodeIndexed,
  //     fields: body.map((v) => {
  //       return {
  //         value: v,
  //         flags: go.ValueFlag.Pointer,
  //       };
  //     })
  //   };
  // }

  public Panic(expression: NodeId): Node {
    return {
      opcode: go.Opcode.Panic,
      flags: go.NodeFlag.NodeUnary,
      value: {
        value: expression,
        flags: go.ValueFlag.Pointer,
      },
    };
  }

  public Recover(): Node {
    return {
      opcode: go.Opcode.Panic,
      flags: go.NodeFlag.None,
    };
  }

  public CreateMakeNode(params: NodeId[]): Node {
    return {
      opcode: go.Opcode.Make,
      flags: go.NodeFlag.NodeIndexed,
      fields: params.map((v) => {
        return {
          value: v,
          flags: go.ValueFlag.Pointer,
        };
      }),
    };
  }

  public New(_type: Type): Node {
    return {
      // WARN - NEEDS ATTENTION
      opcode: go.Opcode.Panic,
      flags: go.NodeFlag.NodeUnary,
      value: {
        value: 0n,
        flags: go.ValueFlag.Pointer,
      },
    };
  }

  public CreateLenNode(param: NodeId): Node {
    return {
      opcode: go.Opcode.Len,
      flags: go.NodeFlag.NodeUnary,
      value: {
        value: param,
        flags: go.ValueFlag.Pointer,
      },
    };
  }

  public CreateCapNode(param: NodeId): Node {
    return {
      opcode: go.Opcode.Cap,
      flags: go.NodeFlag.NodeUnary,
      value: {
        value: param,
        flags: go.ValueFlag.Pointer,
      },
    };
  }

  public CreateAppendNode(params: NodeId[]): Node {
    return {
      opcode: go.Opcode.Cap,
      flags: go.NodeFlag.NodeUnary,
      fields: params.map((v) => {
        return {
          value: v,
          flags: go.ValueFlag.Pointer,
        };
      }),
    };
  }

  public CreateCopyNode(dst: NodeId, src: NodeId): Node {
    return {
      opcode: go.Opcode.Copy,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: dst,
        flags: go.ValueFlag.Pointer,
      },
      right: {
        value: src,
        flags: go.ValueFlag.Pointer,
      },
    };
  }

  public CreateCloseNode(chan: Type): Node {
    return {
      // WARN - NEEDS ATTENTION
      opcode: go.Opcode.Close,
      flags: go.NodeFlag.NodeUnary,
      value: {
        value: 0n,
        flags: go.ValueFlag.Pointer,
      },
    };
  }

  public CreateComplexNode(r: string, i: string): Node {
    return {
      opcode: go.Opcode.Complex,
      flags: go.NodeFlag.NodeBinary,
      left: {
        value: r,
        flags: go.ValueFlag.None,
      },
      right: {
        value: i,
        flags: go.ValueFlag.None,
      },
    };
  }

  public CreateRealNode(c: NodeId): Node {
    return {
      opcode: go.Opcode.Real,
      flags: go.NodeFlag.NodeUnary,
      value: {
        value: c,
        flags: go.ValueFlag.Pointer,
      },
    };
  }

  public CreateImagNode(c: NodeId): Node {
    return {
      opcode: go.Opcode.Imag,
      flags: go.NodeFlag.NodeUnary,
      value: {
        value: c,
        flags: go.ValueFlag.Pointer,
      },
    };
  }

  public CreatePrintNode(params: NodeId[]): Node {
    return {
      opcode: go.Opcode.Print,
      flags: go.NodeFlag.NodeIndexed,
      fields: params.map((v) => {
        return {
          value: v,
          flags: go.ValueFlag.Pointer,
        };
      }),
    };
  }

  public CreatePrintlnNode(params: NodeId[]): Node {
    return {
      opcode: go.Opcode.Println,
      flags: go.NodeFlag.NodeIndexed,
      fields: params.map((v) => {
        return {
          value: v,
          flags: go.ValueFlag.Pointer,
        };
      }),
    };
  }

  public PrintNodes(): void {
    this.nodes.forEach((v, k) => {
      console.log(
        `${k} (${v[1]}) -> ${JSON.stringify(v[0], (_, v) => (typeof v === "bigint" ? v.toString() : v))}`,
      );
    });
  }

  public PrintLUT(): void {
    this.stringlut.forEach((v, k) => {
      console.log(`${k} -> ${v}`);
    });
  }

  private HashString(s: string): number {
    // cite: https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function
    let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis

    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0; // FNV prime and force 32-bit
    }

    return hash >>> 0;
  }

  private SetString(s: string): number {
    const hash = this.HashString(s);

    this.stringlut.set(hash, s);
    return hash;
  }

  private CreateStringLUT(): fb.Offset {
    const offsets: fb.Offset[] = [];
    for (const [k, v] of this.stringlut) {
      const value = this.builder.createString(v);

      program.StringEntry.startStringEntry(this.builder);
      program.StringEntry.addKey(this.builder, k);
      program.StringEntry.addValue(this.builder, value);
      const entry = program.StringEntry.endStringEntry(this.builder);
      offsets.push(entry);
    }
    return program.App.createLutVector(this.builder, offsets);
  }

  private CreateIndexedNode(node: Node): fb.Offset {
    let fields: fb.Offset[] = [];
    if (node.fields) {
      for (const value of node.fields) {
        program.NodeValue.startNodeValue(this.builder);
        //schema.NodeValue.addType(this.builder, this.GetString(value.type || "")); // WARN - Implement types
        if (typeof value.value == "string")
          program.NodeValue.addValue(
            this.builder,
            BigInt(this.SetString(value.value || "")),
          );
        else program.NodeValue.addValue(this.builder, value.value || 0n);

        program.NodeValue.addFlags(this.builder, value.flags);
        const offset = program.NodeValue.endNodeValue(this.builder);
        fields.push(offset);
      }
      const fieldsVector = program.IndexedNode.createFieldsVector(
        this.builder,
        fields,
      );
      program.IndexedNode.addFields(this.builder, fieldsVector);
    }
    program.IndexedNode.startIndexedNode(this.builder);
    program.IndexedNode.addId(this.builder, this.SetString(node.id || ""));

    return program.IndexedNode.endIndexedNode(this.builder);
  }

  private CreateBinaryNode(node: Node): fb.Offset {
    let left: fb.Offset = 0;
    let right: fb.Offset = 0;

    if (node.left) {
      program.NodeValue.startNodeValue(this.builder);
      /* schema.NodeValue.addType(
        this.builder,
        this.GetString(node.left.type || "")
      ); */
      if (typeof node.left.value == "string")
        program.NodeValue.addValue(
          this.builder,
          BigInt(this.SetString(node.left.value || "")),
        );
      else program.NodeValue.addValue(this.builder, node.left.value || 0n);

      program.NodeValue.addFlags(this.builder, node.left.flags);
      left = program.NodeValue.endNodeValue(this.builder);
    }

    if (node.right) {
      program.NodeValue.startNodeValue(this.builder);
      /* schema.NodeValue.addType(
        this.builder,
        this.GetString(node.right.type || "")
      ); */
      if (typeof node.right.value == "string")
        program.NodeValue.addValue(
          this.builder,
          BigInt(this.SetString(node.right.value || "")),
        );
      else program.NodeValue.addValue(this.builder, node.right.value || 0n);

      program.NodeValue.addFlags(this.builder, node.right.flags);
      right = program.NodeValue.endNodeValue(this.builder);
    }

    program.BinaryNode.startBinaryNode(this.builder);
    program.BinaryNode.addLeft(this.builder, left);
    program.BinaryNode.addRight(this.builder, right);
    return program.BinaryNode.endBinaryNode(this.builder);
  }

  private CreateUnaryNode(node: Node): fb.Offset {
    let value: fb.Offset = 0;
    if (node.value) {
      program.NodeValue.startNodeValue(this.builder);
      /* schema.NodeValue.addType(
        this.builder,
        this.GetString(node.value.type || "")
      ); */
      if (typeof node.value.value == "string")
        program.NodeValue.addValue(
          this.builder,
          BigInt(this.SetString(node.value.value || "")),
        );
      else program.NodeValue.addValue(this.builder, node.value.value || 0n);

      program.NodeValue.addFlags(this.builder, node.value.flags);
      value = program.NodeValue.endNodeValue(this.builder);
    }

    program.UnaryNode.startUnaryNode(this.builder);
    program.UnaryNode.addValue(this.builder, value);
    return program.UnaryNode.endUnaryNode(this.builder);
  }

  public Export(flags: number = 0): Uint8Array {
    const nodeOffsets: fb.Offset[] = Array.from(this.nodes.values()).map(
      ([_, offset]) => offset,
    );
    const nodesVector = program.App.createNodesVector(
      this.builder,
      nodeOffsets,
    );

    const stringLUT = this.CreateStringLUT();

    const defaultName = "Unnamed Program";
    const programName = this.builder.createString(
      this.options.name || defaultName,
    );

    program.App.startApp(this.builder);
    program.App.addNodes(this.builder, nodesVector);
    program.App.addLut(this.builder, stringLUT);
    program.App.addFlags(this.builder, flags);
    program.App.addName(this.builder, programName);
    const programOffset = program.App.endApp(this.builder);
    this.builder.finish(programOffset);
    return this.builder.asUint8Array();
  }

  public Clear() {
    this.builder.clear();
    this.nodes.clear();
  }

  public async Rebuild(flags: number = 0): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      this.builder.clear();
      const nodes: fb.Offset[] = [];
      for (const [id, [node, offset]] of this.nodes) {
        const nodeOffset = this.buildNode(node);
        nodes.push(nodeOffset);
      }
      const nodesVector = program.App.createNodesVector(this.builder, nodes);

      const defaultName = "Unnamed Program";
      const programName = this.builder.createString(
        this.options.name || defaultName,
      );

      program.App.startApp(this.builder);
      program.App.addNodes(this.builder, nodesVector);
      program.App.addFlags(this.builder, flags);
      program.App.addName(this.builder, programName);
      const programOffset = program.App.endApp(this.builder);
      this.builder.finish(programOffset);
      resolve(this.builder.asUint8Array());
    });
  }

  // Initiates a data stream between the recipitant and the end user
  // Use this to feed the compiler the data live
  public Hook(addr: string) {}
}
