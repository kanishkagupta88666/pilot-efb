import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { AuthBoundary } from './AuthBoundary';
import { saveSession } from './session';
const saved = vi.hoisted(() => ({value:false}));
vi.mock('./runtime',()=>({AUTH_ENABLED:true}));
vi.mock('./savedReading',()=>({hasSavedReading:async()=>saved.value}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();saved.value=false;});
function setup(cached:boolean) {
 saved.value=cached;
 const data=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)});
 saveSession({token:'expired',expiresAt:'2000-01-01T00:00:00Z',user:{employeeId:'P-100',displayName:'P-100',role:'pilot',fleet:'SAMPLE-100'}});
 render(<MemoryRouter initialEntries={['/reader/FM-S100/2']}><Routes><Route path='/sign-in' element={<p>Login destination</p>}/><Route path='*' element={<AuthBoundary><p>Saved manual content</p></AuthBoundary>}/></Routes></MemoryRouter>);
}
it('keeps saved reading open when sign-in has expired',async()=>{setup(true);expect(await screen.findByText('Saved manual content')).toBeTruthy();expect(screen.getByRole('status').textContent).toContain('Sign in to keep updates');});
it('requests sign-in when expired and no reading is saved',async()=>{setup(false);await waitFor(()=>expect(screen.getByText('Login destination')).toBeTruthy());});
