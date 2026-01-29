import * as fb from "flatbuffers";
import * as program from "./program";

export interface BuilderOptions {
  size?: number; // Initial size allocated towards the builder.
  name?: string; // Program name (used when exporting).

  hookChunkSize?: number; // Max size in bytes of each chunk when streaming.
}

export type NodeId = bigint;

export interface INodeValue {
  value: string | NodeId;
  flags: number;
}

export interface INode<
  TOpcode extends number,
  TNodeValue extends INodeValue = INodeValue
> {
  opcode: TOpcode;
  parent?: NodeId;
  next?: NodeId;
  flags: number;
  // Indexed Node
  id?: string;
  fields?: TNodeValue[];
  // Binary Node
  left?: TNodeValue;
  right?: TNodeValue;
  // Unary Node
  value?: TNodeValue;
}

export abstract class IBuilder<
  TOpcode extends number,
  TNodeFlag extends number,
  TValueFlag extends number
> {
  protected builder: fb.Builder;
  protected nodes = new Map<NodeId, [INode<TOpcode>, fb.Offset]>();
  protected stringlut = new Map<number, string>();
  protected typelut: Map<number, fb.Offset> = new Map();

  constructor(protected builderOptions: BuilderOptions) {
    this.builder = new fb.Builder(builderOptions.size ?? 1024);
  };

  protected abstract buildNode(node: INode<TOpcode>, id: NodeId): fb.Offset;
  protected abstract CreateStringLUT(): fb.Offset;

  public abstract SetNode(node: INode<TOpcode>, id?: NodeId): NodeId;
  public abstract DeleteNode(id: NodeId, recursive?: boolean): void;


  public PrintNodes(): void {
    for (const [id, [node, offset]] of this.nodes) {
      console.log(
        `${id} (${offset}) -> ${JSON.stringify(node, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`,
      );
    }
  }

  public PrintLUT(): void {
    for (const [hash, string] of this.stringlut) {
      console.log(`${hash} -> ${string}`);
    }
  }

  // Export / Rebuild
    
  private buildApp(
    nodeOffsets: fb.Offset[],
    flags: number,
    includeLUT: boolean,
  ): Uint8Array {
    const nodesVector = program.App.createNodesVector(this.builder, nodeOffsets);
    
    let lut: fb.Offset = 0;
    if (includeLUT) {
      lut = this.CreateStringLUT();
    }
    
    const name = this.builder.createString(
      this.builderOptions.name ?? "Unnamed Program",
    );
    
    program.App.startApp(this.builder);
    program.App.addNodes(this.builder, nodesVector);
    
    if (includeLUT) {
      program.App.addLut(this.builder, lut);
    }
    
    program.App.addFlags(this.builder, flags);
    program.App.addName(this.builder, name);
    
    const programOffset = program.App.endApp(this.builder);
    this.builder.finish(programOffset);
    
    return this.builder.asUint8Array();
  }
    
  public Export(flags: number = 0): Uint8Array {
    const nodeOffsets: fb.Offset[] = Array.from(this.nodes.values()).map(
      ([_, offset]) => offset,
    );
    
    return this.buildApp(nodeOffsets, flags, true);
  }
    
  public async Rebuild(flags: number = 0): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      this.builder.clear();
    
      const nodeOffsets: fb.Offset[] = [];
      for (const [id, [node, offset]] of this.nodes) {
        const nodeOffset = this.buildNode(node, id);
        this.nodes.set(id, [node, nodeOffset]);
    
        nodeOffsets.push(nodeOffset);
      }
    
      resolve(this.buildApp(nodeOffsets, flags, false));
    });
  }
    
  public Clear() {
    this.builder.clear();
    this.nodes.clear();
    this.stringlut.clear();
  }
};