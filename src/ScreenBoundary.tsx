import {Component} from 'react'
import type {ReactNode} from 'react'
export class ScreenBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<section className="test-panel" role="alert"><h2>This screen could not be loaded.</h2><p>Your saved progress is still on this device. Try opening the screen again after reconnecting.</p><button className="secondary-button" onClick={()=>this.setState({failed:false})}>Try again</button></section>:this.props.children}
}
