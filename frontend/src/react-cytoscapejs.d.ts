declare module "react-cytoscapejs" {
  import { Component } from "react";
  export interface CytoscapeComponentProps {
    elements: any[];
    stylesheet?: any;
    layout?: any;
    style?: React.CSSProperties;
    cy?: (cy: any) => void;
    [key: string]: any;
  }
  export default class CytoscapeComponent extends Component<CytoscapeComponentProps> {}
}
