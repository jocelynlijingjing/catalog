/* Curved, two-sided paper. No external libraries or network dependencies. */
(() => {
  'use strict';
  const PAD_X = .08, PAD_Y = .16;
  const clamp = (x, min, max) => Math.max(min, Math.min(max, x));

  function surface(u, v, progress, direction, grab) {
    const lift = Math.sin(Math.PI * progress);
    const theta = Math.PI * progress + .18 * lift * (v - .5) * (grab - .5) * 2;
    const bend = 1.10 * lift * (1 + .18 * (v - grab));
    const start = theta - bend;
    const angle = start + 2 * bend * u;
    let x, z;
    if (Math.abs(bend) < .0001) {
      x = u * Math.cos(theta); z = u * Math.sin(theta);
    } else {
      x = (Math.sin(angle) - Math.sin(start)) / (2 * bend);
      z = (Math.cos(start) - Math.cos(angle)) / (2 * bend);
    }
    // A slight bow between the spine and the free edge prevents a rigid roll.
    z += .025 * lift * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    const camera = 9.0, perspective = camera / (camera - z);
    const screenX = .5 + direction * x * perspective * .5;
    const screenY = .5 + (v - .5) * perspective;
    return {
      x: (screenX + PAD_X) / (1 + PAD_X * 2),
      y: (screenY + PAD_Y) / (1 + PAD_Y * 2),
      z, u, v,
      nx: -direction * Math.sin(angle), nz: Math.cos(angle),
      facing: Math.cos(angle) * (camera - z) + Math.sin(angle) * x,
      bookX: screenX
    };
  }

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  class SoftPaperTurn {
    constructor(canvas, shadow) {
      this.canvas = canvas; this.shadow = shadow; this.progress = 0;
      this.direction = 1; this.grab = .78; this.images = null;
      this.columns = 72; this.rows = 16;
      try {
        const gl = canvas.getContext('webgl', {alpha:true, antialias:true, premultipliedAlpha:false});
        if (!gl) throw new Error('Use canvas paper renderer');
        this.gl = gl; this.initGL();
        canvas.dataset.renderer = 'webgl';
        canvas.addEventListener('webglcontextlost', event => {
          event.preventDefault(); this.useCanvas(); this.resize(); this.draw(this.progress);
        }, {once:true});
      } catch (error) {
        this.useCanvas();this.canvas.dataset.fallbackReason=error.message;
      }
    }

    useCanvas() {
      // A separate element is needed after a WebGL context has been allocated.
      const replacement = this.canvas.cloneNode(false);
      this.canvas.replaceWith(replacement); this.canvas = replacement;
      this.gl = null; this.ctx = replacement.getContext('2d');
      replacement.dataset.renderer = 'canvas';
      this.columns = 60; this.rows = 6;
    }

    initGL() {
      const gl = this.gl;
      const vs = compile(gl, gl.VERTEX_SHADER, `
        attribute vec3 a_position;
        attribute vec2 a_uv;
        attribute vec2 a_normal;
        attribute float a_facing;
        varying vec2 v_uv;
        varying vec2 v_normal;
        varying float v_facing;
        void main(){
          gl_Position=vec4(a_position,1.0);
          v_uv=a_uv;v_normal=a_normal;v_facing=a_facing;
        }`);
      const fs = compile(gl, gl.FRAGMENT_SHADER, `
        precision mediump float;
        uniform sampler2D u_front;
        uniform sampler2D u_back;
        uniform float u_direction;
        uniform float u_lift;
        varying vec2 v_uv;
        varying vec2 v_normal;
        varying float v_facing;
        void main(){
          bool front=v_facing>=0.0;
          vec2 uv=vec2(0.5+(front?1.0:-1.0)*u_direction*v_uv.x*0.5,v_uv.y);
          vec4 paper=front?texture2D(u_front,uv):texture2D(u_back,uv);
          vec3 n=normalize(vec3(v_normal.x,0.0,v_normal.y))*(front?1.0:-1.0);
          float light=max(0.0,dot(n,normalize(vec3(-0.35,-0.2,1.0))));
          float shade=1.0-u_lift*(0.12+0.22*(1.0-light));
          float sheen=u_lift*0.045*pow(light,10.0);
          gl_FragColor=vec4(paper.rgb*shade+vec3(sheen),1.0);
        }`);
      const program = gl.createProgram();
      gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
      gl.deleteShader(vs);gl.deleteShader(fs);
      if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program); this.program = program;
      this.vertexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,this.vertexBuffer);
      const stride = 8 * 4;
      [['a_position',3,0],['a_uv',2,12],['a_normal',2,20],['a_facing',1,28]].forEach(([name,size,offset])=>{
        const location=gl.getAttribLocation(program,name);
        gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,stride,offset);
      });
      const indices=[];
      for(let y=0;y<this.rows;y++)for(let x=0;x<this.columns;x++){
        const a=y*(this.columns+1)+x,b=a+1,c=a+this.columns+1,d=c+1;
        indices.push(a,c,b,b,c,d);
      }
      this.indexCount=indices.length;
      this.indexBuffer=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
      this.vertices=new Float32Array((this.columns+1)*(this.rows+1)*8);
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);
      gl.clearColor(0,0,0,0);
      this.uniformDirection=gl.getUniformLocation(program,'u_direction');
      this.uniformLift=gl.getUniformLocation(program,'u_lift');
      this.textures=[gl.createTexture(),gl.createTexture()];
      gl.uniform1i(gl.getUniformLocation(program,'u_front'),0);
      gl.uniform1i(gl.getUniformLocation(program,'u_back'),1);
    }

    setImages(front, back, direction, grab=.78) {
      this.images=[front,back];this.direction=direction;this.grab=clamp(grab,0,1);
      this.resize();
      if (!this.gl) return;
      const gl=this.gl,maxSize=Math.min(4096,gl.getParameter(gl.MAX_TEXTURE_SIZE));
      try { this.images.forEach((image,index)=>{
        let source=image;
        if(image.naturalWidth>maxSize||image.naturalHeight>maxSize){
          source=document.createElement('canvas');
          const ratio=maxSize/Math.max(image.naturalWidth,image.naturalHeight);
          source.width=Math.round(image.naturalWidth*ratio);source.height=Math.round(image.naturalHeight*ratio);
          source.getContext('2d').drawImage(image,0,0,source.width,source.height);
        }
        gl.activeTexture(gl.TEXTURE0+index);gl.bindTexture(gl.TEXTURE_2D,this.textures[index]);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
      }); } catch (_) { this.useCanvas();this.resize(); }
    }

    resize() {
      const rect=this.canvas.parentElement.getBoundingClientRect();
      const dpr=Math.min(window.devicePixelRatio||1,2);
      this.width=Math.max(1,Math.round(rect.width*(1+PAD_X*2)*dpr));
      this.height=Math.max(1,Math.round(rect.height*(1+PAD_Y*2)*dpr));
      this.canvas.width=this.width;this.canvas.height=this.height;
      if(this.gl)this.gl.viewport(0,0,this.width,this.height);
    }

    draw(progress) {
      if(!this.images)return;
      this.progress=clamp(progress,0,1);
      const points=[];
      let minX=1,maxX=0;
      for(let row=0;row<=this.rows;row++)for(let col=0;col<=this.columns;col++){
        const point=surface(col/this.columns,row/this.rows,this.progress,this.direction,this.grab);
        minX=Math.min(minX,point.bookX);maxX=Math.max(maxX,point.bookX);points.push(point);
      }
      if(this.gl)this.drawGL(points);else this.drawCanvas(points);
      const lift=Math.sin(Math.PI*this.progress);
      this.shadow.style.left=`${Math.min(minX,.5)*100}%`;
      this.shadow.style.width=`${Math.max(.025,maxX-minX)*100}%`;
      this.shadow.style.opacity=String(lift*.52);
      this.shadow.style.filter=`blur(${4+lift*13}px)`;
    }

    drawGL(points) {
      const gl=this.gl,vertices=this.vertices;
      points.forEach((p,i)=>{const o=i*8;vertices[o]=p.x*2-1;vertices[o+1]=1-p.y*2;
        vertices[o+2]=-p.z*.8;vertices[o+3]=p.u;vertices[o+4]=p.v;
        vertices[o+5]=p.nx;vertices[o+6]=p.nz;vertices[o+7]=p.facing;});
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.vertexBuffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.DYNAMIC_DRAW);
      gl.uniform1f(this.uniformDirection,this.direction);gl.uniform1f(this.uniformLift,Math.sin(Math.PI*this.progress));
      gl.drawElements(gl.TRIANGLES,this.indexCount,gl.UNSIGNED_SHORT,0);
    }

    drawCanvas(points) {
      const ctx=this.ctx;ctx.clearRect(0,0,this.width,this.height);
      const triangles=[];
      for(let row=0;row<this.rows;row++)for(let col=0;col<this.columns;col++){
        const a=row*(this.columns+1)+col,b=a+1,c=a+this.columns+1,d=c+1;
        triangles.push([points[a],points[c],points[b]],[points[b],points[c],points[d]]);
      }
      triangles.sort((a,b)=>a.reduce((s,p)=>s+p.z,0)-b.reduce((s,p)=>s+p.z,0));
      for(const tri of triangles)this.drawTriangle(tri);
      const xs=points.map(p=>p.x*this.width),left=Math.min(...xs),right=Math.max(...xs);
      const lift=Math.sin(Math.PI*this.progress);
      if(right-left>1&&lift>.001){
        ctx.save();ctx.globalCompositeOperation='source-atop';
        const gradient=ctx.createLinearGradient(this.direction>0?left:right,0,this.direction>0?right:left,0);
        gradient.addColorStop(0,`rgba(35,28,22,${lift*.06})`);
        gradient.addColorStop(.4,`rgba(35,28,22,${lift*.02})`);
        gradient.addColorStop(.82,`rgba(35,28,22,${lift*.20})`);
        gradient.addColorStop(.97,`rgba(35,28,22,${lift*.30})`);
        gradient.addColorStop(1,`rgba(255,255,255,${lift*.10})`);
        ctx.fillStyle=gradient;ctx.fillRect(0,0,this.width,this.height);ctx.restore();
      }
    }

    drawTriangle(tri) {
      const ctx=this.ctx,front=tri.reduce((s,p)=>s+p.facing,0)>=0,image=this.images[front?0:1];
      const destination=tri.map(p=>({x:p.x*this.width,y:p.y*this.height}));
      const source=tri.map(p=>({x:(.5+(front?1:-1)*this.direction*p.u*.5)*image.naturalWidth,y:p.v*image.naturalHeight}));
      const [s0,s1,s2]=source,[d0,d1,d2]=destination;
      const sx1=s1.x-s0.x,sy1=s1.y-s0.y,sx2=s2.x-s0.x,sy2=s2.y-s0.y;
      const det=sx1*sy2-sx2*sy1;if(Math.abs(det)<.0001)return;
      const dx1=d1.x-d0.x,dy1=d1.y-d0.y,dx2=d2.x-d0.x,dy2=d2.y-d0.y;
      const a=(dx1*sy2-dx2*sy1)/det,b=(dy1*sy2-dy2*sy1)/det;
      const c=(dx2*sx1-dx1*sx2)/det,d=(dy2*sx1-dy1*sx2)/det;
      ctx.save();ctx.beginPath();
      const orientation=Math.sign((d1.x-d0.x)*(d2.y-d0.y)-(d1.y-d0.y)*(d2.x-d0.x))||1;
      destination.forEach((p,i)=>{
        const before=destination[(i+2)%3],after=destination[(i+1)%3];
        const edge1={x:p.x-before.x,y:p.y-before.y},edge2={x:after.x-p.x,y:after.y-p.y};
        const len1=Math.hypot(edge1.x,edge1.y)||1,len2=Math.hypot(edge2.x,edge2.y)||1;
        const n1={x:orientation*edge1.y/len1,y:-orientation*edge1.x/len1};
        const n2={x:orientation*edge2.y/len2,y:-orientation*edge2.x/len2};
        const denominator=Math.max(.15,1+n1.x*n2.x+n1.y*n2.y);
        ctx[i?'lineTo':'moveTo'](p.x+clamp((n1.x+n2.x)/denominator*.55,-1.8,1.8),p.y+clamp((n1.y+n2.y)/denominator*.55,-1.8,1.8));
      });
      ctx.closePath();ctx.clip();
      ctx.setTransform(a,b,c,d,d0.x-a*s0.x-c*s0.y,d0.y-b*s0.x-d*s0.y);
      ctx.drawImage(image,0,0);ctx.setTransform(1,0,0,1,0,0);
      ctx.restore();
    }
  }
  window.SoftPaperTurn=SoftPaperTurn;
})();
