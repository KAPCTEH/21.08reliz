(function(){
  'use strict';

  const ACTION_ATTRIBUTE_PREFIX='data-jf-on';
  const ACTION_NAME=/^(?:add|apply|approve|assign|build|change|choose|clear|close|commit|confirm|create|delete|edit|export|filter|focus|hide|import|invalidate|load|mark|open|pick|preview|print|recalculate|remove|render|request|reset|resolve|restart|restore|retry|revoke|run|save|schedule|scroll|search|select|set|show|smart|start|step|switch|sync|toggle|update|use)[A-Za-z0-9_$]*$/;
  const EVENT_TYPES=['click','change','input','submit','blur','keydown','dragstart','dragover','drop'];

  function actionError(message,source){
    const error=new Error(`${message}${source?` [${source}]`:''}`);
    error.code='JF_ACTION_DISPATCH';
    console.error(error);
    window.dispatchEvent(new CustomEvent('justfun:action-error',{detail:{message:error.message,source:String(source||'')}}));
    return error;
  }

  function splitTopLevel(source,separator){
    const output=[];let start=0,depth=0,quote='';
    for(let index=0;index<source.length;index+=1){
      const char=source[index];
      if(quote){
        if(char==='\\'){index+=1;continue}
        if(char===quote)quote='';
        continue;
      }
      if(char==='\''||char==='"'||char==='`'){quote=char;continue}
      if(char==='('||char==='['||char==='{')depth+=1;
      else if(char===')'||char===']'||char==='}')depth-=1;
      else if(char===separator&&depth===0){output.push(source.slice(start,index).trim());start=index+1}
      if(depth<0)throw actionError('Нарушен баланс скобок в действии',source);
    }
    if(quote||depth!==0)throw actionError('Незавершённое выражение действия',source);
    output.push(source.slice(start).trim());
    return output.filter(Boolean);
  }

  function decodeString(source){
    const quote=source[0];let output='';
    if(source.length<2||source.at(-1)!==quote)throw actionError('Незавершённая строка действия',source);
    for(let index=1;index<source.length-1;index+=1){
      const char=source[index];
      if(char!=='\\'){output+=char;continue}
      index+=1;if(index>=source.length-1)throw actionError('Неверное экранирование строки',source);
      const escaped=source[index];
      const simple={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'};
      if(Object.prototype.hasOwnProperty.call(simple,escaped))output+=simple[escaped];
      else if(escaped==='u'&&/^[0-9a-fA-F]{4}$/.test(source.slice(index+1,index+5))){output+=String.fromCharCode(parseInt(source.slice(index+1,index+5),16));index+=4}
      else output+=escaped;
    }
    return output;
  }

  function eventForElement(event,element){
    return new Proxy(event,{
      get(target,property){
        if(property==='currentTarget')return element;
        const value=Reflect.get(target,property,target);
        return typeof value==='function'?value.bind(target):value;
      }
    });
  }

  function memberValue(source,element,event){
    const parts=source.split('.');
    const root=parts.shift();
    let value=root==='this'?element:(root==='event'?event:undefined);
    if(value===undefined)throw actionError('Недопустимое значение аргумента',source);
    for(const part of parts){
      if(!/^[A-Za-z_$][\w$]*$/.test(part)||['__proto__','prototype','constructor'].includes(part))throw actionError('Недопустимое свойство аргумента',source);
      value=value?.[part];
    }
    return value;
  }

  function argumentValue(source,element,event){
    const value=source.trim();
    if(!value)return undefined;
    if((value[0]==='\''||value[0]==='"')&&value.at(-1)===value[0])return decodeString(value);
    if(value==='true')return true;if(value==='false')return false;if(value==='null')return null;if(value==='undefined')return undefined;
    if(/^-?(?:\d+\.?\d*|\.\d+)$/.test(value))return Number(value);
    const conversion=value.match(/^(String|Number|Boolean)\((.*)\)$/s);
    if(conversion){const nested=argumentValue(conversion[2],element,event);return conversion[1]==='String'?String(nested):(conversion[1]==='Number'?Number(nested):Boolean(nested))}
    if(/^(?:this|event)(?:\.[A-Za-z_$][\w$]*)*$/.test(value))return memberValue(value,element,event);
    throw actionError('Неподдерживаемый аргумент действия',value);
  }

  function invokeGlobal(statement,element,event){
    const match=statement.match(/^([A-Za-z_$][\w$]*)\((.*)\)$/s);
    if(!match||!ACTION_NAME.test(match[1]))throw actionError('Недопустимое действие интерфейса',statement);
    const action=window[match[1]];
    if(typeof action!=='function')throw actionError(`Функция ${match[1]} не найдена`,statement);
    const args=match[2].trim()?splitTopLevel(match[2],',').map(value=>argumentValue(value,element,event)):[];
    return action.apply(element,args);
  }

  function executeStatement(raw,element,event){
    let statement=raw.trim(),returns=false;
    if(statement.startsWith('return ')){returns=true;statement=statement.slice(7).trim()}
    if(statement==='false'){event.preventDefault();return false}
    if(statement==='event.stopPropagation()'){event.stopPropagation();return}
    if(statement==='event.preventDefault()'){event.preventDefault();return}
    const clear=statement.match(/^document\.getElementById\((['"][^'"]+['"])\)\.value\s*=\s*(['"].*['"])$/s);
    if(clear){const target=document.getElementById(decodeString(clear[1]));if(!target)throw actionError('Поле для действия не найдено',statement);target.value=decodeString(clear[2]);return}
    const closest=statement.match(/^this\.closest\((['"].*['"])\)\.removeAttribute\((['"].*['"])\)$/s);
    if(closest){element.closest(decodeString(closest[1]))?.removeAttribute(decodeString(closest[2]));return}
    const result=invokeGlobal(statement,element,event);
    if(returns&&result===false)event.preventDefault();
    return result;
  }

  function execute(source,element,event){
    let result;
    for(const statement of splitTopLevel(String(source||''),';'))result=executeStatement(statement,element,event);
    return result;
  }

  function handleDispatchFailure(error,source,event){
    if(error?.code!=='JF_ACTION_DISPATCH')actionError(error?.message||String(error),source);
    event.preventDefault();
    event.stopPropagation();
  }

  function dispatch(event){
    const attribute=`${ACTION_ATTRIBUTE_PREFIX}${event.type}`;
    const path=typeof event.composedPath==='function'?event.composedPath():[];
    const elements=path.length?path.filter(item=>item?.nodeType===1):[event.target];
    for(const element of elements){
      const source=element?.getAttribute?.(attribute);
      if(!source)continue;
      try{
        const result=execute(source,element,eventForElement(event,element));
        if(result&&typeof result.then==='function')result.catch(error=>handleDispatchFailure(error,source,event));
      }catch(error){handleDispatchFailure(error,source,event)}
      if(event.cancelBubble)break;
    }
  }

  EVENT_TYPES.forEach(type=>document.addEventListener(type,dispatch,false));
  window.JustFunActionBridge=Object.freeze({execute,eventTypes:[...EVENT_TYPES]});
})();
