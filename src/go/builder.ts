import * as fb from "flatbuffers";
import * as tree from "./go";
import { Type, TypeDef } from "./types";

export type NodeId = number

export interface GoBuilderOptions {
  size?: number;
  name?: string;
}

export interface NodeValue {
  type?: TypeDef;
  value: string | number;
  flags: number;
}

export interface Node {
  opcode: number;
  parent?: NodeId;
  next?: NodeId;
  flags: number;
  // Type 1
  id?: string;
  fields?: NodeValue[];
  // Type 2
  left?: NodeValue;
  right?: NodeValue;
  // Type 3
  value?: NodeValue;
}

export interface FuncDef {
  type: TypeDef,
  params?: number[] // Input parameters
  body?: number[] // Array of node id
}

export class GoBuilder {
  private builder: fb.Builder;
  private stringTable: Map<number, string> = new Map();
  private strNextId = 1;
  private nodes: Map<number, Node> = new Map();
  private nextId = 0;

  constructor(private options: GoBuilderOptions) {
    const defaultSize = 1024;
    this.builder = new fb.Builder(options.size || defaultSize);

    this.stringTable.set(0, "");
  }

  public SetNode(node: Node, id?: number): NodeId {
    //! CLEAN THIS FUNCTION
    if (id != undefined && !Number.isSafeInteger(id)) {
      console.error(`Identifier must be integer! Got: ${id}`);
      return -1;
    }
    if (id != undefined) this.nextId = id + 1;
    else this.nextId++;
    this.nodes.set(id || this.nextId, node);
    return id || this.nextId;
  }

  public DeleteNode(id: number, recursive?: boolean) {
    if (recursive) {
      const node = this.nodes.get(id);
      if (!node) {
        console.error(`Unknown id of ${id}`);
        return;
      }

      for (const n of node.fields || []) {
        if (n.flags & tree.ValueFlag.Pointer) continue;

        const success = this.nodes.delete(n.value as number);
        if (!success)
          console.warn(`Failed to delete node part of ${id}: ${n.value}`);
      }
    }

    this.nodes.delete(id);
  }

  public UpdateNodeField(id: number, index: number, field: NodeValue) {
    if (index < 0) {
      console.error(`Invalid index of ${index}.`);
      return;
    }
    const node = this.nodes.get(id);
    if (node) {
      if (node.fields && index < node.fields.length) {
        node.fields[index] = field;
      } else
        console.error(
          `Node does not have any fields or index is greater than the amount of allocated fields.`
        );
    } else console.error(`Could not find node with ${id}.`);
  }

  public ConnectNodes(parent: number, child: number) {
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

    targetNode.next = child;
    sourceNode.parent = parent;
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
      opcode: tree.Opcode.Package,
      id,
      flags: tree.Flag.NodeType1,
    };
  }

  public CreateImportNode(...imports: number[]): Node {
    return {
      opcode: tree.Opcode.Import,
      fields: imports.map((v: number): NodeValue => {
        return {
          value: v,
          flags: tree.ValueFlag.Pointer,
        };
      }),
      flags: tree.Flag.NodeType1,
    };
  }

  public CreateImportValueNode(path: string, alias?: string): Node {
    return {
      opcode: tree.Opcode.ImportValue,
      left: {
        value: alias || "",
        flags: 0,
      },
      right: {
        value: path,
        flags: 0,
      },
      flags: tree.Flag.NodeType2,
    };
  }

  public CreateConstNode(...constants: number[]): Node {
    return {
      opcode: tree.Opcode.Const,
      fields: constants.map((v, i) => {
        return {
          value: v,
          flags: tree.ValueFlag.Pointer,
        };
      }),
      flags: tree.Flag.NodeType1,
    };
  }

  public CreateConstValueNode(name: string, type: TypeDef, value: string): Node {
    return {
      opcode: tree.Opcode.Const,
      left: {
        type,
        value: name,
        flags: 0,
      },
      right: {
        value,
        flags: 0,
      },
      flags: tree.Flag.NodeType1,
    };
  }

  public CreateVarNode(...vars: number[]): Node {
    return {
      opcode: tree.Opcode.Var,
      fields: vars.map((v, i) => {
        return {
          value: v,
          flags: tree.ValueFlag.Pointer,
        };
      }),
      flags: tree.Flag.NodeType1,
    };
  }

  public CreateVarValueNode(name: string, type: TypeDef, value: string): Node {
    return {
      opcode: tree.Opcode.VarValue,
      left: {
        type,
        value: name,
        flags: 0,
      },
      right: {
        value,
        flags: 0,
      },
      flags: tree.Flag.NodeType1,
    };
  }

  public CreateTypeNode(id: string, type: TypeDef): Node {
    return {
      opcode: tree.Opcode.Type,
      id,
      fields: [
        {
          type,
          value: 0,
          flags: tree.ValueFlag.Pointer,
        },
      ],
      flags: tree.Flag.NodeType1,
    };
  }

  public CreateFuncNode(def: FuncDef): Node {
    const meta: NodeValue = {
      type: def.type,
      value: -1,
      flags: tree.ValueFlag.None,
    }

    let params: NodeValue[] = [];
    if (def.params) {
      params = def.params.map((v) => {
        return {
          value: v,
          flags: tree.ValueFlag.Pointer | 61, //! Add proper value flag definition
        }
      })
    }


    let body: NodeValue[] = [];
    if (def.body) {
      body = def.body?.map((v) => {
        return {
          value: v,
          flags: tree.ValueFlag.Pointer | 67, //! Add proper value flag definition
        }
      })
    }

    return {
      opcode: tree.Opcode.Func,
      id: def.type.id,
      fields: [meta, ...params, ...body],
      flags: tree.Flag.NodeType1,
    }
  }

  

  public TestBuild(): void {
    this.nodes.forEach((v, k) => {
      console.log(`${k} -> ${JSON.stringify(v)}`);
    });
  }

  private GetString(s: string): number {
    for (const [n, v] of this.stringTable) {
      if (v !== s) {
        continue;
      }
      return n;
    }
    this.stringTable.set(++this.strNextId, s);
    return this.strNextId;
  }

  private CreateType1(id: number, node: Node): fb.Offset {
    let fields: fb.Offset[] = [];
    if (node.fields) {
      for (const value of node.fields) {
        tree.NodeValue.startNodeValue(this.builder);
        //tree.NodeValue.addType(this.builder, this.GetString(value.type || ""));
        if (typeof value.value == "string")
          tree.NodeValue.addValue(
            this.builder,
            BigInt(this.GetString(value.value || ""))
          );
        else tree.NodeValue.addValue(this.builder, BigInt(value.value || 0));

        tree.NodeValue.addFlags(this.builder, value.flags);
        const offset = tree.NodeValue.endNodeValue(this.builder);
        fields.push(offset);
      }
      const fieldsVector = tree.Type1.createFieldsVector(this.builder, fields);
      tree.Type1.addFields(this.builder, fieldsVector);
    }
    tree.Type1.startType1(this.builder);
    tree.Type1.addId(this.builder, this.GetString(node.id || "")); //! This can be optimized

    return tree.Type1.endType1(this.builder);
  }

  private CreateType2(id: number, node: Node): fb.Offset {
    let left: fb.Offset = 0;
    let right: fb.Offset = 0;

    if (node.left) {
      tree.NodeValue.startNodeValue(this.builder);
      /* tree.NodeValue.addType(
        this.builder,
        this.GetString(node.left.type || "")
      ); */
      if (typeof node.left.value == "string")
        tree.NodeValue.addValue(
          this.builder,
          BigInt(this.GetString(node.left.value || ""))
        );
      else tree.NodeValue.addValue(this.builder, BigInt(node.left.value || 0));

      tree.NodeValue.addFlags(this.builder, node.left.flags);
      left = tree.NodeValue.endNodeValue(this.builder);
    }

    if (node.right) {
      tree.NodeValue.startNodeValue(this.builder);
      /* tree.NodeValue.addType(
        this.builder,
        this.GetString(node.right.type || "")
      ); */
      if (typeof node.right.value == "string")
        tree.NodeValue.addValue(
          this.builder,
          BigInt(this.GetString(node.right.value || ""))
        );
      else tree.NodeValue.addValue(this.builder, BigInt(node.right.value || 0));

      tree.NodeValue.addFlags(this.builder, node.right.flags);
      right = tree.NodeValue.endNodeValue(this.builder);
    }

    tree.Type2.startType2(this.builder);
    tree.Type2.addLeft(this.builder, left);
    tree.Type2.addRight(this.builder, right);
    return tree.Type2.endType2(this.builder);
  }

  private CreateType3(id: number, node: Node): fb.Offset {
    let value: fb.Offset = 0;
    if (node.value) {
      tree.NodeValue.startNodeValue(this.builder);
      /* tree.NodeValue.addType(
        this.builder,
        this.GetString(node.value.type || "")
      ); */
      if (typeof node.value.value == "string")
        tree.NodeValue.addValue(
          this.builder,
          BigInt(this.GetString(node.value.value || ""))
        );
      else tree.NodeValue.addValue(this.builder, BigInt(node.value.value || 0));

      tree.NodeValue.addFlags(this.builder, node.value.flags);
      value = tree.NodeValue.endNodeValue(this.builder);
    }

    tree.Type3.startType3(this.builder);
    tree.Type3.addValue(this.builder, value);
    return tree.Type3.endType3(this.builder);
  }

  public GetLut(): Uint8Array {
    return new Uint8Array();
  }

  public async Build(flags: number = 0): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      this.builder.clear();
      // TODO: FIX OBJECT NESTING: you can't nest the starts and ends within eachother
      const nodes = new Array<fb.Offset>(this.nodes.size);
      for (const [id, node] of this.nodes) {
        let nodeType: number = 0;
        let nodeContentOffset: fb.Offset = 0;
        switch (node.flags) {
          case tree.Flag.NodeType1:
            nodeType = tree.NodeUnion.Type1;
            nodeContentOffset = this.CreateType1(id, node);
            break;
          case tree.Flag.NodeType2:
            nodeType = tree.NodeUnion.Type2;
            nodeContentOffset = this.CreateType2(id, node);
            break;
          case tree.Flag.NodeType3:
            nodeType = tree.NodeUnion.Type3;
            nodeContentOffset = this.CreateType3(id, node);
            break;
          default:
            nodeType = tree.NodeUnion.NONE;
            break;
        }
        tree.Node.startNode(this.builder);
        tree.Node.addOpcode(this.builder, node.opcode);
        tree.Node.addParent(this.builder, BigInt(node.parent || 0));
        tree.Node.addNext(this.builder, BigInt(node.next || 0));
        tree.Node.addFlags(this.builder, node.flags);
        tree.Node.addNodeType(this.builder, nodeType);
        tree.Node.addNode(this.builder, nodeContentOffset);
        const nodeOffset = tree.Node.endNode(this.builder);
        nodes.push(nodeOffset);
      }
      const nodesVector = tree.Program.createNodesVector(this.builder, nodes);

      const defaultName = "Unnamed Program";
      const programName = this.builder.createString(
        this.options.name || defaultName
      );

      tree.Program.startProgram(this.builder);
      tree.Program.addNodes(this.builder, nodesVector);
      tree.Program.addFlags(this.builder, flags);
      tree.Program.addName(this.builder, programName);
      const programOffset = tree.Program.endProgram(this.builder);
      this.builder.finish(programOffset);
      resolve(this.builder.asUint8Array());
    });
  }
}