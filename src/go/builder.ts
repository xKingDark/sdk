import * as fb from "flatbuffers";
import * as schema from "./golang";
import { Type, TypeDef } from "./types";

export type NodeId = bigint;

export interface GoBuilderOptions {
  size?: number;
  name?: string;
}

export interface NodeValue {
  type?: TypeDef;
  value: string | NodeId;
  flags: number;
}

export interface Node {
  opcode: schema.Opcode;
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
  type: TypeDef;
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
      case schema.Flag.NodeIndexed:
        nodeType = schema.NodeUnion.IndexedNode;
        nodeContentOffset = this.CreateIndexedNode(node);
        break;
      case schema.Flag.NodeBinary:
        nodeType = schema.NodeUnion.BinaryNode;
        nodeContentOffset = this.CreateBinaryNode(node);
        break;
      case schema.Flag.NodeUnary:
        nodeType = schema.NodeUnion.UnaryNode;
        nodeContentOffset = this.CreateUnaryNode(node);
        break;
      default:
        nodeType = schema.NodeUnion.NONE;
        break;
    }
    schema.Node.startNode(this.builder);
    schema.Node.addOpcode(this.builder, node.opcode);
    schema.Node.addParent(this.builder, node.parent || 0n);
    schema.Node.addNext(this.builder, node.next || 0n);
    schema.Node.addFlags(this.builder, node.flags);
    schema.Node.addNodeType(this.builder, nodeType);
    schema.Node.addNode(this.builder, nodeContentOffset);
    return schema.Node.endNode(this.builder);
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
      //! Implement
      for (const n of node[0].fields || []) {
        if (n.flags & schema.ValueFlag.Pointer) continue;

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
      console.error(`Length of package id must be greater than zero!`); //! Add regex check
    return {
      opcode: schema.Opcode.Package,
      id,
      flags: schema.Flag.NodeIndexed,
    };
  }

  public CreateImportNode(...imports: NodeId[]): Node {
    return {
      opcode: schema.Opcode.Import,
      fields: imports.map((v): NodeValue => {
        return {
          value: v,
          flags: schema.ValueFlag.Pointer,
        };
      }),
      flags: schema.Flag.NodeIndexed,
    };
  }

  public CreateImportValueNode(path: string, alias?: string): Node {
    return {
      opcode: schema.Opcode.ImportValue,
      left: {
        value: alias || "",
        flags: 0,
      },
      right: {
        value: path,
        flags: 0,
      },
      flags: schema.Flag.NodeBinary,
    };
  }

  public CreateConstNode(...constants: NodeId[]): Node {
    return {
      opcode: schema.Opcode.Const,
      fields: constants.map((v) => {
        return {
          value: v,
          flags: schema.ValueFlag.Pointer,
        };
      }),
      flags: schema.Flag.NodeIndexed,
    };
  }

  public CreateConstValueNode(
    name: string,
    type: TypeDef,
    value: string
  ): Node {
    return {
      opcode: schema.Opcode.Const,
      left: {
        type,
        value: name,
        flags: 0,
      },
      right: {
        value,
        flags: 0,
      },
      flags: schema.Flag.NodeIndexed,
    };
  }

  public CreateVarNode(...vars: NodeId[]): Node {
    return {
      opcode: schema.Opcode.Var,
      fields: vars.map((v) => {
        return {
          value: v,
          flags: schema.ValueFlag.Pointer,
        };
      }),
      flags: schema.Flag.NodeIndexed,
    };
  }

  public CreateVarValueNode(name: string, type: TypeDef, value: string): Node {
    return {
      opcode: schema.Opcode.VarValue,
      left: {
        type,
        value: name,
        flags: 0,
      },
      right: {
        value,
        flags: 0,
      },
      flags: schema.Flag.NodeIndexed,
    };
  }

  public CreateTypeNode(type: TypeDef): Node {
    return {
      opcode: schema.Opcode.Type,
      id: type.id,
      fields: [
        {
          type,
          value: 0n,
          flags: schema.ValueFlag.None,
        },
      ],
      flags: schema.Flag.NodeIndexed,
    };
  }

  public CreateFuncNode(def: FuncDef): Node {
    const meta: NodeValue = {
      type: def.type,
      value: 0n,
      flags: schema.ValueFlag.None,
    };

    let params: NodeValue[] = [];
    if (def.params) {
      params = def.params.map((v) => {
        return {
          value: v,
          flags: schema.ValueFlag.Pointer | 0, //! Add proper value flag definition
        };
      });
    }

    let body: NodeValue[] = [];
    if (def.body) {
      body = def.body?.map((v) => {
        return {
          value: v,
          flags: schema.ValueFlag.Pointer | 0, //! Add proper value flag definition
        };
      });
    }

    return {
      opcode: schema.Opcode.Func,
      id: def.type.id,
      fields: [meta, ...params, ...body],
      flags: schema.Flag.NodeIndexed,
    };
  }

  public CreateIfNode(
    condition: bigint,
    body: bigint[],
    _else: bigint[]
  ): Node {
    return {
      opcode: schema.Opcode.If,
      fields: [
        {
          value: condition,
          flags: schema.ValueFlag.Pointer,
        },
        ...body.map((v) => {
          return {
            value: v,
            flags: schema.ValueFlag.Pointer,
          };
        }),
        ..._else.map((v) => {
          return {
            value: v,
            flags: schema.ValueFlag.Pointer,
          };
        }),
      ],
      flags: schema.Flag.NodeIndexed,
    };
  }

  public CreateForNode(
    init: bigint,
    cond: bigint,
    post: bigint,
    body: bigint[]
  ): Node {
    return {
      opcode: schema.Opcode.For,
      flags: schema.Flag.NodeIndexed,
    };
  }

  public PrintNodes(): void {
    this.nodes.forEach((v, k) => {
      console.log(
        `${k} (${v[1]}) -> ${JSON.stringify(v[0], (_, v) => (typeof v === "bigint" ? v.toString() : v))}`
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

      schema.StringEntry.startStringEntry(this.builder);
      schema.StringEntry.addKey(this.builder, k);
      schema.StringEntry.addValue(this.builder, value);
      const entry = schema.StringEntry.endStringEntry(this.builder);
      offsets.push(entry);
    }
    return schema.Program.createLutVector(this.builder, offsets);
  }

  private CreateIndexedNode(node: Node): fb.Offset {
    let fields: fb.Offset[] = [];
    if (node.fields) {
      for (const value of node.fields) {
        schema.NodeValue.startNodeValue(this.builder);
        //schema.NodeValue.addType(this.builder, this.GetString(value.type || "")); //! Implement types
        if (typeof value.value == "string")
          schema.NodeValue.addValue(
            this.builder,
            BigInt(this.SetString(value.value || ""))
          );
        else schema.NodeValue.addValue(this.builder, value.value || 0n);

        schema.NodeValue.addFlags(this.builder, value.flags);
        const offset = schema.NodeValue.endNodeValue(this.builder);
        fields.push(offset);
      }
      const fieldsVector = schema.IndexedNode.createFieldsVector(
        this.builder,
        fields
      );
      schema.IndexedNode.addFields(this.builder, fieldsVector);
    }
    schema.IndexedNode.startIndexedNode(this.builder);
    schema.IndexedNode.addId(this.builder, this.SetString(node.id || ""));

    return schema.IndexedNode.endIndexedNode(this.builder);
  }

  private CreateBinaryNode(node: Node): fb.Offset {
    let left: fb.Offset = 0;
    let right: fb.Offset = 0;

    if (node.left) {
      schema.NodeValue.startNodeValue(this.builder);
      /* schema.NodeValue.addType(
        this.builder,
        this.GetString(node.left.type || "")
      ); */
      if (typeof node.left.value == "string")
        schema.NodeValue.addValue(
          this.builder,
          BigInt(this.SetString(node.left.value || ""))
        );
      else schema.NodeValue.addValue(this.builder, node.left.value || 0n);

      schema.NodeValue.addFlags(this.builder, node.left.flags);
      left = schema.NodeValue.endNodeValue(this.builder);
    }

    if (node.right) {
      schema.NodeValue.startNodeValue(this.builder);
      /* schema.NodeValue.addType(
        this.builder,
        this.GetString(node.right.type || "")
      ); */
      if (typeof node.right.value == "string")
        schema.NodeValue.addValue(
          this.builder,
          BigInt(this.SetString(node.right.value || ""))
        );
      else schema.NodeValue.addValue(this.builder, node.right.value || 0n);

      schema.NodeValue.addFlags(this.builder, node.right.flags);
      right = schema.NodeValue.endNodeValue(this.builder);
    }

    schema.BinaryNode.startBinaryNode(this.builder);
    schema.BinaryNode.addLeft(this.builder, left);
    schema.BinaryNode.addRight(this.builder, right);
    return schema.BinaryNode.endBinaryNode(this.builder);
  }

  private CreateUnaryNode(node: Node): fb.Offset {
    let value: fb.Offset = 0;
    if (node.value) {
      schema.NodeValue.startNodeValue(this.builder);
      /* schema.NodeValue.addType(
        this.builder,
        this.GetString(node.value.type || "")
      ); */
      if (typeof node.value.value == "string")
        schema.NodeValue.addValue(
          this.builder,
          BigInt(this.SetString(node.value.value || ""))
        );
      else schema.NodeValue.addValue(this.builder, node.value.value || 0n);

      schema.NodeValue.addFlags(this.builder, node.value.flags);
      value = schema.NodeValue.endNodeValue(this.builder);
    }

    schema.UnaryNode.startUnaryNode(this.builder);
    schema.UnaryNode.addValue(this.builder, value);
    return schema.UnaryNode.endUnaryNode(this.builder);
  }

  public Export(flags: number = 0): Uint8Array {
    const nodeOffsets: fb.Offset[] = Array.from(this.nodes.values()).map(
      ([_, offset]) => offset
    );
    const nodesVector = schema.Program.createNodesVector(
      this.builder,
      nodeOffsets
    );

    const stringLUT = this.CreateStringLUT();

    const defaultName = "Unnamed Program";
    const programName = this.builder.createString(
      this.options.name || defaultName
    );

    schema.Program.startProgram(this.builder);
    schema.Program.addNodes(this.builder, nodesVector);
    schema.Program.addLut(this.builder, stringLUT);
    schema.Program.addFlags(this.builder, flags);
    schema.Program.addName(this.builder, programName);
    const programOffset = schema.Program.endProgram(this.builder);
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
      const nodesVector = schema.Program.createNodesVector(this.builder, nodes);

      const defaultName = "Unnamed Program";
      const programName = this.builder.createString(
        this.options.name || defaultName
      );

      schema.Program.startProgram(this.builder);
      schema.Program.addNodes(this.builder, nodesVector);
      schema.Program.addFlags(this.builder, flags);
      schema.Program.addName(this.builder, programName);
      const programOffset = schema.Program.endProgram(this.builder);
      this.builder.finish(programOffset);
      resolve(this.builder.asUint8Array());
    });
  }
}
